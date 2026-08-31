export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
    message = 'The request could not be completed.',
  ) {
    super(message);
  }
}
export function requireValue(
  condition: unknown,
  code: string,
  status = 400,
  message?: string,
): asserts condition {
  if (!condition) throw new AppError(code, status, message);
}
export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeout = 20000,
) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new AppError(
      'UPSTREAM_UNAVAILABLE',
      503,
      'The connected service is unavailable. Please try again.',
    );
  }
}
