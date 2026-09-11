import type { z } from 'zod';
import {
  eligibleAIProviders,
  type AIPreferences,
  type AIProviderName,
} from '../ai-settings';
import { OpenAIProvider, type ModelProvider, type ModelUsage } from './ai';
import { ClaudeProvider } from './claude';
import { env } from './config';
import { AppError, requireValue } from './errors';
import type { ModelDiagnostic } from '../ai-diagnostics';
import type { WebResearch } from './web-research';
import {
  callSignal,
  stageAttempt,
  withinBudget,
  type ModelCallOptions,
} from './chat-budget';
import { modelTimeout } from './model-http';
export type ProviderAttempt = Partial<ModelDiagnostic> & {
  provider: AIProviderName;
  model: string;
  status: 'completed' | 'failed';
  errorCode?: string;
  elapsedMs?: number;
  step?: 'routing' | 'research' | 'response';
  attemptTimeoutMs?: number;
  stageRemainingMs?: number;
  backupEligible?: boolean;
};
const fallbackErrors = new Set([
  'AI_QUOTA_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_NETWORK_ERROR',
  'AI_RESEARCH_UNAVAILABLE',
]);

function sharedDeadlineOptions(options: ModelCallOptions): ModelCallOptions {
  const { deadlineAt, ...shared } = options;
  if (deadlineAt !== undefined) {
    // Convert the absolute deadline once. Recreating its timer for each adapter
    // or retry can revive a timed-out stage when timer and wall-clock ticks differ.
    // Downstream calls inherit this cancellation signal and add only their own
    // per-attempt timeout; they must not recreate the absolute-deadline timer.
    shared.signal = callSignal(options, Infinity);
  }
  return shared;
}

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
    const totals = new Map<string, ModelUsage>();
    for (const item of this.choices.flatMap(
      (provider) => provider.usage || [],
    )) {
      const key = `${item.provider || ''}:${item.model || ''}`;
      const current = totals.get(key);
      if (current) {
        current.inputTokens += item.inputTokens;
        current.outputTokens += item.outputTokens;
        current.totalTokens += item.totalTokens;
        current.webSearches =
          (current.webSearches || 0) + (item.webSearches || 0);
      } else totals.set(key, { ...item });
    }
    return [...totals.values()];
  }
  private record(attempt: ProviderAttempt) {
    this.attempts.push(attempt);
  }
  private beginAttempt(
    options: ModelCallOptions,
    sharedOptions: ModelCallOptions,
  ) {
    const attempt = stageAttempt(sharedOptions, options, modelTimeout());
    return {
      ...attempt,
      backupEligible: this.index + 1 < this.choices.length,
    };
  }
  async research(
    query: string,
    timeZone: string,
    options: ModelCallOptions = {},
  ): Promise<WebResearch> {
    const sharedOptions = sharedDeadlineOptions(options);
    while (true) {
      const selected = this.choices[this.index];
      const started = Date.now();
      const diagnosticCount = selected.diagnostics?.length || 0;
      const attempt = this.beginAttempt(options, sharedOptions);
      try {
        if (!selected.research)
          throw new AppError('AI_RESEARCH_UNAVAILABLE', 503);
        const output = await withinBudget(
          selected.research(query, timeZone, {
            ...sharedOptions,
            signal: attempt.signal,
          }),
          attempt.signal,
        );
        this.record({
          provider: selected.name,
          model: selected.model,
          status: 'completed',
          step: 'research',
          elapsedMs: Date.now() - started,
          attemptTimeoutMs: attempt.timeoutMs,
          stageRemainingMs: attempt.stageRemainingMs,
          backupEligible: attempt.backupEligible,
          ...selected.diagnostics?.[diagnosticCount],
        });
        return output;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'AI_FAILED';
        this.record({
          provider: selected.name,
          model: selected.model,
          status: 'failed',
          errorCode: code,
          step: 'research',
          elapsedMs: Date.now() - started,
          attemptTimeoutMs: attempt.timeoutMs,
          stageRemainingMs: attempt.stageRemainingMs,
          backupEligible: attempt.backupEligible,
          ...selected.diagnostics?.[diagnosticCount],
        });
        if (
          sharedOptions.signal?.aborted ||
          (options.deadlineAt ?? Infinity) <= Date.now() ||
          !fallbackErrors.has(code) ||
          this.index + 1 >= this.choices.length
        )
          throw error;
        this.index++;
      }
    }
  }
  async structured<T>(
    schema: z.ZodType<T>,
    instructions: string,
    input: unknown[],
    options: ModelCallOptions = {},
  ): Promise<T> {
    const sharedOptions = sharedDeadlineOptions(options);
    while (true) {
      const selected = this.choices[this.index];
      const started = Date.now();
      const step = this.completedCalls === 0 ? 'routing' : 'response';
      const diagnosticCount = selected.diagnostics?.length || 0;
      const attempt = this.beginAttempt(options, sharedOptions);
      try {
        const output = await withinBudget(
          selected.structured(schema, instructions, input, {
            ...sharedOptions,
            signal: attempt.signal,
          }),
          attempt.signal,
        );
        this.record({
          provider: selected.name,
          model: selected.model,
          status: 'completed',
          step,
          elapsedMs: Date.now() - started,
          attemptTimeoutMs: attempt.timeoutMs,
          stageRemainingMs: attempt.stageRemainingMs,
          backupEligible: attempt.backupEligible,
          ...selected.diagnostics?.[diagnosticCount],
        });
        this.completedCalls++;
        return output;
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'AI_FAILED';
        this.record({
          provider: selected.name,
          model: selected.model,
          status: 'failed',
          errorCode: code,
          step,
          elapsedMs: Date.now() - started,
          attemptTimeoutMs: attempt.timeoutMs,
          stageRemainingMs: attempt.stageRemainingMs,
          backupEligible: attempt.backupEligible,
          ...selected.diagnostics?.[diagnosticCount],
        });
        if (
          sharedOptions.signal?.aborted ||
          (options.deadlineAt ?? Infinity) <= Date.now() ||
          !fallbackErrors.has(code) ||
          this.index + 1 >= this.choices.length
        )
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
