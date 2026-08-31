import { afterEach, expect, it, vi } from 'vitest';
import { modelFetch } from '../lib/server/model-fetch';
import type { ModelDiagnostic } from '../lib/ai-diagnostics';
import { modelHttpError } from '../lib/server/model-http';
import { FallbackProvider } from '../lib/server/ai-provider';
import { OpenAIProvider } from '../lib/server/ai';
import { RouteOutput } from '../lib/contracts';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('blocks redirects without forwarding private keys or storing upstream text', async () => {
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response('private upstream text', {
        status: 302,
        headers: {
          location: 'https://untrusted.invalid',
          'x-request-id': 'req_123456789abcdef',
        },
      }),
    );
  const trace: ModelDiagnostic[] = [];
  const response = await modelFetch(
    'https://api.openai.com/v1/responses',
    { headers: { Authorization: 'Bearer private-test-key' } },
    trace,
  );
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock.mock.calls[0][1]?.redirect).toBe('manual');
  expect((await modelHttpError('openai', response)).code).toBe(
    'AI_REDIRECT_BLOCKED',
  );
  expect(trace[0]).toMatchObject({
    httpStatus: 302,
    providerRequestId: 'req_123456789abcdef',
  });
  expect(JSON.stringify(trace)).not.toMatch(/private|untrusted/);
});
it.each([
  [
    new TypeError('Invalid redirect value, contains private data'),
    'AI_TRANSPORT_CONFIG_INVALID',
    'configuration',
  ],
  [
    new DOMException('private timeout details', 'TimeoutError'),
    'AI_TIMEOUT',
    'timeout',
  ],
  [new TypeError('private network details'), 'AI_NETWORK_ERROR', 'network'],
])(
  'classifies transport failures without exposing exception messages',
  async (error, code, transport) => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);
    const trace: ModelDiagnostic[] = [];
    await expect(
      modelFetch('https://api.openai.com/v1/responses', {}, trace),
    ).rejects.toMatchObject({ code });
    expect(trace[0].transport).toBe(transport);
    expect(JSON.stringify(trace)).not.toContain('private');
  },
);
it('records HTTP status, duration and request references on failed provider attempts', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'private-test');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      {
        error: {
          code: 'insufficient_quota',
          message: 'private billing details',
        },
      },
      { status: 429, headers: { 'x-request-id': 'req_0123456789abcdef' } },
    ),
  );
  const provider = new FallbackProvider([new OpenAIProvider()]);
  await expect(
    provider.structured(RouteOutput, 'private prompt', []),
  ).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
  expect(provider.attempts[0]).toMatchObject({
    provider: 'openai',
    step: 'routing',
    httpStatus: 429,
    providerRequestId: 'req_0123456789abcdef',
    status: 'failed',
  });
  expect(provider.attempts[0].elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(provider.attempts)).not.toContain('private');
});
it('rejects arbitrary response header content as a request identifier', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(null, {
      headers: { 'x-request-id': 'private customer email@example.com' },
    }),
  );
  const trace: ModelDiagnostic[] = [];
  await modelFetch('https://api.openai.com/v1/responses', {}, trace);
  expect(trace[0].providerRequestId).toBeUndefined();
});
