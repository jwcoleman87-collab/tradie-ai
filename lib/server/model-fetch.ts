import type { ModelDiagnostic } from '../ai-diagnostics';
import { AppError } from './errors';

// Workers does not implement redirect:'error'. Manual mode never forwards keys
// to another origin; callers reject all non-2xx responses, including redirects.
export async function modelFetch(
  url: string,
  init: RequestInit,
  diagnostics: ModelDiagnostic[],
): Promise<Response> {
  const diagnostic: ModelDiagnostic = { clientRequestId: crypto.randomUUID() };
  diagnostics.push(diagnostic);
  const headers = new Headers(init.headers);
  if (url === 'https://api.openai.com/v1/responses')
    headers.set('X-Client-Request-Id', diagnostic.clientRequestId);
  try {
    const response = await fetch(url, { ...init, headers, redirect: 'manual' });
    diagnostic.httpStatus = response.status;
    const requestId =
      response.headers.get('x-request-id') ||
      response.headers.get('request-id');
    // IDs only, never arbitrary upstream headers or raw error text.
    if (requestId && /^req_[A-Za-z0-9]{8,100}$/.test(requestId))
      diagnostic.providerRequestId = requestId;
    return response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const name = error instanceof Error ? error.name : '';
    const configuration =
      error instanceof TypeError &&
      /^(Invalid redirect value|Unsupported cache mode)/.test(error.message);
    const timeout =
      name === 'TimeoutError' || name === 'AbortError' || init.signal?.aborted;
    diagnostic.transport = configuration
      ? 'configuration'
      : timeout
        ? 'timeout'
        : 'network';
    throw new AppError(
      configuration
        ? 'AI_TRANSPORT_CONFIG_INVALID'
        : timeout
          ? 'AI_TIMEOUT'
          : 'AI_NETWORK_ERROR',
      503,
    );
  }
}
