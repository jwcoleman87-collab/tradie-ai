import type { z } from 'zod';
import {
  eligibleAIProviders,
  type AIPreferences,
  type AIProviderName,
} from '../ai-settings';
import { OpenAIProvider, type ModelProvider } from './ai';
import { ClaudeProvider } from './claude';
import { env } from './config';
import { AppError, requireValue } from './errors';
import type { ModelDiagnostic } from '../ai-diagnostics';
export type ProviderAttempt = Partial<ModelDiagnostic> & {
  provider: AIProviderName;
  model: string;
  status: 'completed' | 'failed';
  errorCode?: string;
  elapsedMs?: number;
  step?: 'routing' | 'response';
};
const fallbackErrors = new Set([
  'AI_QUOTA_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_NETWORK_ERROR',
]);
export class FallbackProvider implements ModelProvider {
  private index = 0;
  private completedCalls = 0;
  attempts: ProviderAttempt[] = [];
  constructor(
    private readonly choices: (ModelProvider & { name: AIProviderName })[],
  ) {
    requireValue(
      choices.length > 0 && choices.length <= 2,
      'SETUP_REQUIRED',
      503,
      'Add an API key for an AI provider this workspace has allowed.',
    );
  }
  get model() {
    return this.choices[this.index].model;
  }
  get usage() {
    return this.choices.flatMap((p) => p.usage || []);
  }
  async structured<T>(
    schema: z.ZodType<T>,
    instructions: string,
    input: unknown[],
  ): Promise<T> {
    while (true) {
      const selected = this.choices[this.index];
      const started = Date.now();
      const step = this.completedCalls === 0 ? 'routing' : 'response';
      const diagnosticCount = selected.diagnostics?.length || 0;
      try {
        const output = await selected.structured(schema, instructions, input);
        this.attempts.push({
          provider: selected.name,
          model: selected.model,
          status: 'completed',
          step,
          elapsedMs: Date.now() - started,
          ...selected.diagnostics?.[diagnosticCount],
        });
        this.completedCalls++;
        return output;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'AI_FAILED';
        this.attempts.push({
          provider: selected.name,
          model: selected.model,
          status: 'failed',
          errorCode: code,
          step,
          elapsedMs: Date.now() - started,
          ...selected.diagnostics?.[diagnosticCount],
        });
        if (!fallbackErrors.has(code) || this.index + 1 >= this.choices.length)
          throw error;
        this.index++;
      }
    }
  }
}
export function createAIProvider(preferences: AIPreferences) {
  const order = eligibleAIProviders(preferences, {
    openai: !!env('OPENAI_API_KEY'),
    anthropic: !!env('ANTHROPIC_API_KEY'),
  });
  return new FallbackProvider(
    order.map((name) =>
      name === 'openai' ? new OpenAIProvider() : new ClaudeProvider(),
    ),
  );
}
