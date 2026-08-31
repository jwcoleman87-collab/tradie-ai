import { z } from 'zod';
import type { AIProviderName } from '../ai-settings';
import { AppError } from './errors';
import { env } from './config';
export async function boundedModelJson(
  response: Response,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('AI_INVALID_RESPONSE', 502);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new AppError('AI_INVALID_RESPONSE', 502);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'AI_UNAVAILABLE',
      503,
      'The AI connection was interrupted. No actions were executed.',
    );
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AppError(
      'AI_INVALID_RESPONSE',
      502,
      'The AI response could not be read. No actions were executed.',
    );
  }
}
export function modelTimeout() {
  const timeout = Number(env('AI_REQUEST_TIMEOUT_MS') || 30000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 45000)
    throw new AppError('AI_LIMIT_CONFIG_INVALID', 503);
  return timeout;
}
export async function modelHttpError(
  provider: AIProviderName,
  response: Response,
): Promise<AppError> {
  // Inspect only a bounded provider error classification. Never return or log it.
  let error: { type?: string; code?: string; message?: string } = {};
  if (response.status === 400 || response.status === 429) {
    try {
      const data = z
        .object({
          error: z.object({
            type: z.string().optional(),
            code: z.string().nullable().optional(),
            message: z.string().max(5000).optional(),
          }),
        })
        .parse(await boundedModelJson(response, 16000));
      error = { ...data.error, code: data.error.code || undefined };
    } catch {
      /* Fail closed when the upstream error is not recognized. */
    }
  }
  const anthropicCreditError =
    provider === 'anthropic' &&
    response.status === 400 &&
    error.type === 'invalid_request_error' &&
    /^(your credit balance is too low|you have reached your (?:specified )?(?:monthly )?(?:usage|spend) limit)/i.test(
      error.message || '',
    );
  const quota =
    response.status === 402 ||
    error.code === 'insufficient_quota' ||
    anthropicCreditError;
  const code = quota
    ? 'AI_QUOTA_EXCEEDED'
    : response.status === 429
      ? 'AI_RATE_LIMITED'
      : response.status >= 500
        ? 'AI_UNAVAILABLE'
        : response.status === 401
          ? 'AI_KEY_INVALID'
          : response.status === 403
            ? 'AI_ACCESS_DENIED'
            : response.status === 404
              ? 'AI_MODEL_UNAVAILABLE'
              : 'AI_REQUEST_INVALID';
  return new AppError(
    code,
    503,
    quota
      ? 'This AI provider has reached its API credit or usage limit.'
      : code === 'AI_KEY_INVALID'
        ? 'The AI API key needs attention.'
        : code === 'AI_ACCESS_DENIED'
          ? 'The AI project does not have permission for this model.'
          : 'The AI request could not complete. No actions were executed.',
  );
}
export function parseModelJson<T>(schema: z.ZodType<T>, text: string): T {
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new AppError(
      'AI_INVALID_RESPONSE',
      502,
      'The AI returned an invalid response. No actions were executed.',
    );
  }
}
