import { AppError } from './errors';

// Keep these below the database's fixed 150-second lease. Ten seconds are
// reserved for the atomic reply transaction and a durable failure receipt.
export const CHAT_DEADLINE_MS = 120_000;
export const CHAT_WORK_MS = 110_000;
export const CHAT_STAGE_MS = {
  context: 15_000,
  routing: 20_000,
  calendar: 12_000,
  research: 25_000,
  response: 45_000,
} as const;
export type ModelCallOptions = {
  purpose?: 'routing';
  signal?: AbortSignal;
  deadlineAt?: number;
  maxOutputTokens?: number;
};

export function remainingBudgetMs(
  options: ModelCallOptions = {},
  fallbackMs: number,
) {
  const remaining = (options.deadlineAt ?? Infinity) - Date.now();
  return Number.isFinite(remaining) && remaining > 0 ? remaining : fallbackMs;
}

export function callSignal(options: ModelCallOptions = {}, timeout: number) {
  const remaining = Math.min(
    timeout,
    (options.deadlineAt ?? Infinity) - Date.now(),
  );
  if (remaining <= 0 || options.signal?.aborted)
    throw new AppError('AI_TIMEOUT', 503);
  const deadline = AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
  return options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
}

export function stageAttempt(
  sharedOptions: ModelCallOptions,
  original: ModelCallOptions,
  fallbackTimeoutMs: number,
) {
  const now = Date.now();
  const stageRemaining = (original.deadlineAt ?? Infinity) - now;
  const timeout =
    Number.isFinite(stageRemaining) && stageRemaining > 0
      ? stageRemaining
      : fallbackTimeoutMs;
  const stageRemainingMs = Number.isFinite(stageRemaining)
    ? Math.max(0, Math.floor(stageRemaining))
    : undefined;
  const timeoutMs = Math.max(1, Math.floor(timeout));
  // Reuse the absolute stage signal when the attempt may consume the rest of
  // the stage. A second timer of the same remaining duration can fire first
  // and start a leftover-millisecond fallback after the stage is effectively
  // exhausted.
  if (sharedOptions.signal && timeout >= stageRemaining)
    return {
      signal: sharedOptions.signal,
      timeoutMs,
      stageRemainingMs,
    };
  return {
    signal: callSignal(sharedOptions, timeout),
    timeoutMs,
    stageRemainingMs,
  };
}

export function modelCallSignal(
  options: ModelCallOptions = {},
  fallbackTimeoutMs: number,
) {
  if (options.deadlineAt !== undefined)
    return callSignal(options, remainingBudgetMs(options, fallbackTimeoutMs));
  return options.signal ?? callSignal(options, fallbackTimeoutMs);
}

export async function withinBudget<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new AppError('AI_TIMEOUT', 503);
  let abort!: () => void;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        abort = () => reject(new AppError('AI_TIMEOUT', 503));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export function stageOptions(
  signal: AbortSignal | undefined,
  milliseconds: number,
): ModelCallOptions {
  return { signal, deadlineAt: Date.now() + milliseconds };
}

export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}
