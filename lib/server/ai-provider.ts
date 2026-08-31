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
export type ProviderAttempt = {
  provider: AIProviderName;
  model: string;
  status: 'completed' | 'failed';
  errorCode?: string;
};
const fallbackErrors = new Set([
  'AI_QUOTA_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
]);
export class FallbackProvider implements ModelProvider {
  private index = 0;
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
      try {
        const output = await selected.structured(schema, instructions, input);
        this.attempts.push({
          provider: selected.name,
          model: selected.model,
          status: 'completed',
        });
        return output;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'AI_FAILED';
        this.attempts.push({
          provider: selected.name,
          model: selected.model,
          status: 'failed',
          errorCode: code,
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
