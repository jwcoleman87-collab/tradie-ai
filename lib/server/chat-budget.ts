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
