import { afterEach, expect, it, vi } from 'vitest';
import { modelFetch } from '../lib/server/model-fetch';
import type { ModelDiagnostic } from '../lib/ai-diagnostics';
import { modelHttpError } from '../lib/server/model-http';
import { FallbackProvider } from '../lib/server/ai-provider';
import { OpenAIProvider, runTeam } from '../lib/server/ai';
import { RouteOutput } from '../lib/contracts';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('blocks redirects without forwarding private keys or storing upstream text', async () => {
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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

it.each(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-mini-2025-08-07'])(
  'uses minimal reasoning and an explicit reasoning-inclusive budget only for the %s router',
  async (model) => {
    vi.stubEnv('OPENAI_API_KEY', 'private-test');
    vi.stubEnv('OPENAI_MODEL', model);
    vi.stubEnv('WEB_SEARCH_ENABLED', 'false');
    const routing = {
      agents: ['social'],
      reason: 'caption',
      calendarContext: false,
      webSearch: false,
      searchQuery: null,
    };
    const answer = {
      reply: 'A caption ready for review.',
      proposals: [],
      escalation: 'none',
    };
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          status: 'completed',
          output: [
            {
              content: [{ type: 'output_text', text: JSON.stringify(routing) }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 'completed',
          output: [
            {
              content: [{ type: 'output_text', text: JSON.stringify(answer) }],
            },
          ],
        }),
      );
    await runTeam(new FallbackProvider([new OpenAIProvider()]), {
      history: [{ role: 'user', content: 'A short caption please' }],
      timeZone: 'Australia/Sydney',
    });
    const routerRequest = JSON.parse(mock.mock.calls[0][1]?.body as string);
    const answerRequest = JSON.parse(mock.mock.calls[1][1]?.body as string);
    expect(routerRequest).toMatchObject({
      model,
      store: false,
      max_output_tokens: 2048,
      reasoning: { effort: 'minimal' },
    });
    expect(answerRequest).toMatchObject({
      model,
      store: false,
      max_output_tokens: 5000,
    });
    expect(answerRequest.reasoning).toBeUndefined();
    expect(routerRequest.tools).toBeUndefined();
    expect(answerRequest.tools).toBeUndefined();
  },
);

it.each([
  'gpt-4.1-mini',
  'gpt-5.4-mini',
  'gpt-5-pro',
  'gpt-5-chat-latest',
  'custom-model',
])(
  'does not attach an unsupported minimal reasoning setting to %s',
  async (model) => {
    vi.stubEnv('OPENAI_API_KEY', 'private-test');
    vi.stubEnv('OPENAI_MODEL', model);
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      );
    await expect(
      new OpenAIProvider().structured(RouteOutput, '', [], {
        purpose: 'routing',
        maxOutputTokens: 2048,
      }),
    ).rejects.toMatchObject({ code: 'AI_INCOMPLETE' });
    expect(
      JSON.parse(mock.mock.calls[0][1]?.body as string).reasoning,
    ).toBeUndefined();
  },
);

it('keeps incomplete reasoning-budget diagnostics numeric and allowlisted without rerouting or exposing model text', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'private-test');
  vi.stubEnv('OPENAI_MODEL', 'gpt-5-mini');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'incomplete',
      incomplete_details: {
        reason: 'max_output_tokens',
        message: 'PRIVATE PROVIDER DETAILS',
      },
      usage: {
        input_tokens: 400,
        output_tokens: 2048,
        total_tokens: 2448,
        output_tokens_details: { reasoning_tokens: 2048 },
      },
      output: [
        {
          content: [{ type: 'output_text', text: 'PRIVATE PARTIAL RESPONSE' }],
        },
      ],
    }),
  );
  const backup = {
    name: 'anthropic' as const,
    model: 'unchanged-backup',
    structured: vi.fn(),
  };
  const provider = new FallbackProvider([new OpenAIProvider(), backup]);
  await expect(
    provider.structured(RouteOutput, 'PRIVATE PROMPT', [], {
      purpose: 'routing',
      maxOutputTokens: 2048,
    }),
  ).rejects.toMatchObject({ code: 'AI_INCOMPLETE' });
  expect(provider.attempts[0]).toMatchObject({
    step: 'routing',
    incompleteReason: 'max_output_tokens',
    maxOutputTokens: 2048,
    outputTokens: 2048,
    reasoningTokens: 2048,
    reasoningEffort: 'minimal',
  });
  expect(JSON.stringify(provider.attempts)).not.toContain('PRIVATE');
  expect(backup.structured).not.toHaveBeenCalled();
});

it('does not retain arbitrary incomplete reasons or invalid reasoning-token counts', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'private-test');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'incomplete',
      incomplete_details: { reason: 'PRIVATE UNKNOWN REASON' },
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
        output_tokens_details: { reasoning_tokens: 999 },
      },
    }),
  );
  const provider = new OpenAIProvider();
  await expect(provider.structured(RouteOutput, '', [])).rejects.toMatchObject({
    code: 'AI_INCOMPLETE',
  });
  expect(provider.diagnostics[0].incompleteReason).toBeUndefined();
  expect(provider.diagnostics[0].reasoningTokens).toBeUndefined();
  expect(JSON.stringify(provider.diagnostics)).not.toContain('PRIVATE');
});
