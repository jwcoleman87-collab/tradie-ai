import { ZodError } from 'zod';
import { AppError } from './errors';
import { appOrigin } from './config';

export const noStore = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noStore });
}
export function endpoint(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const requestId = crypto.randomUUID();
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && origin !== appOrigin())
          throw new AppError('ORIGIN_FORBIDDEN', 403);
      }
      return await handler(request);
    } catch (error) {
      const known = error instanceof AppError,
        invalid = error instanceof ZodError;
      const status = known ? error.status : invalid ? 400 : 500;
      const code = known
        ? error.code
        : invalid
          ? 'INVALID_INPUT'
          : 'INTERNAL_ERROR';
      // Never log bodies, provider errors, OAuth tokens, emails, or customer text.
      console.error(
        JSON.stringify({ event: 'request_failed', requestId, code, status }),
      );
      return json(
        {
          error: {
            code,
            message: known
              ? error.message
              : invalid
                ? 'Please check the information and try again.'
                : 'Something went wrong. Your private data was not included in the error report.',
            requestId,
          },
        },
        status,
      );
    }
  };
}
export async function body(request: Request, maxBytes = 48000) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new AppError('JSON_REQUIRED', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_INPUT');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError('BODY_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new AppError('INVALID_JSON');
  }
}
