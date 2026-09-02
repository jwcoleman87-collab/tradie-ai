import { afterEach, describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { FallbackProvider, createAIProvider } from '../lib/server/ai-provider';
import {
  ClaudeProvider,
  claudeMessages,
  claudeSchema,
} from '../lib/server/claude';
import { AppError } from '../lib/server/errors';
import { modelHttpError, boundedModelJson } from '../lib/server/model-http';
import { runTeam } from '../lib/server/ai';
import {
  eligibleAIProviders,
  AIConsentInput,
  type AIProviderName,
} from '../lib/ai-settings';
import { publicConfig } from '../lib/server/config';
import { AgentOutput, RouteOutput } from '../lib/contracts';
const schema = z.object({ ok: z.boolean() }).strict();
const make = (name: AIProviderName) => ({
  name,
  model: name + '-test',
  structured: vi.fn().mockResolvedValue({ ok: true }),
  usage: [],
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('bounds model response bodies and rejects malformed JSON', async () => {
  await expect(
    boundedModelJson(new Response('x'.repeat(50)), 10),
  ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  await expect(
    boundedModelJson(new Response('{invalid')),
  ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
});
it('records a real adapter switch between routing and generation', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-openai');
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-claude');
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  agents: ['social'],
                  reason: 'post draft',
                  webSearch: false,
                  searchQuery: null,
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              reply: 'Here is a private draft.',
              proposals: [],
              escalation: 'none',
            }),
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    );
  const result = await runTeam(
    createAIProvider({
      ai_primary_provider: 'openai',
      ai_fallback_enabled: true,
      ai_allowed_providers: ['openai', 'anthropic'],
    }),
    {
      history: [{ role: 'user', content: 'Draft a social post' }],
      records: [],
      timeZone: 'Australia/Sydney',
      calendar: { available: false },
      attachments: [],
    },
  );
  expect(mock).toHaveBeenCalledTimes(3);
  expect(result.providerTrace.map((x) => x.provider + ':' + x.status)).toEqual([
    'openai:completed',
    'openai:failed',
    'anthropic:completed',
  ]);
  expect(result.usage.map((x) => x.provider)).toEqual(['openai', 'anthropic']);
  expect(result.reply).toBe('Here is a private draft.');
});
describe('privacy-first provider selection', () => {
  it('keeps legacy consent OpenAI-only', () => {
    expect(
      AIConsentInput.parse({ workspaceId: crypto.randomUUID(), allowAI: true })
        .allowedProviders,
    ).toEqual(['openai']);
  });
  it('requires explicit primary provider consent', () => {
    expect(
      AIConsentInput.safeParse({
        workspaceId: crypto.randomUUID(),
        allowAI: true,
        primaryProvider: 'anthropic',
      }).success,
    ).toBe(false);
  });
  it('does not send to a configured but unconsented backup', () => {
    expect(
      eligibleAIProviders(
        {
          ai_primary_provider: 'openai',
          ai_fallback_enabled: true,
          ai_allowed_providers: ['openai'],
        },
        { openai: false, anthropic: true },
      ),
    ).toEqual([]);
  });
  it('supports Claude-only and both-direction priority', () => {
    expect(
      eligibleAIProviders(
        {
          ai_primary_provider: 'anthropic',
          ai_fallback_enabled: true,
          ai_allowed_providers: ['openai', 'anthropic'],
        },
        { openai: true, anthropic: true },
      ),
    ).toEqual(['anthropic', 'openai']);
    expect(
      eligibleAIProviders(
        {
          ai_primary_provider: 'anthropic',
          ai_fallback_enabled: false,
          ai_allowed_providers: ['openai', 'anthropic'],
        },
        { openai: true, anthropic: false },
      ),
    ).toEqual([]);
  });
  it('requires at least one eligible private key', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-claude-secret');
    expect(() =>
      createAIProvider({
        ai_primary_provider: 'openai',
        ai_fallback_enabled: true,
        ai_allowed_providers: ['openai'],
      }),
    ).toThrow();
    const c = publicConfig();
    expect(c.aiReady).toBe(true);
    expect(c.aiProviders.anthropic).toBe(true);
    expect(JSON.stringify(c)).not.toContain('test-claude-secret');
  });
});
describe('bounded availability fallback', () => {
  it('switches providers for research while retaining a bounded audit trace', async () => {
    const a = {
        ...make('openai'),
        research: vi
          .fn()
          .mockRejectedValue(new AppError('AI_RESEARCH_UNAVAILABLE', 503)),
      },
      b = {
        ...make('anthropic'),
        research: vi.fn().mockResolvedValue({
          summary: 'current notes',
          sources: [{ title: 'source', url: 'https://example.gov.au/' }],
          searchedAt: '2026-09-02T00:00:00.000Z',
          provider: 'anthropic',
        }),
      };
    const provider = new FallbackProvider([a, b]);
    await provider.structured(schema, 'route', []);
    await expect(
      provider.research('current public update', 'Australia/Sydney'),
    ).resolves.toMatchObject({ provider: 'anthropic' });
    await provider.structured(schema, 'response', []);
    expect(provider.attempts).toHaveLength(3);
    expect(provider.attempts.map((attempt) => attempt.step)).toEqual([
      'research',
      'research',
      'response',
    ]);
    expect(provider.model).toBe('anthropic-test');
  });
  for (const primary of ['openai', 'anthropic'] as const)
    for (const code of [
      'AI_QUOTA_EXCEEDED',
      'AI_RATE_LIMITED',
      'AI_UNAVAILABLE',
    ])
      it(`${primary} switches on ${code} and stays on backup`, async () => {
        const a = make(primary),
          b = make(primary === 'openai' ? 'anthropic' : 'openai');
        a.structured.mockRejectedValue(new AppError(code, 503));
        const p = new FallbackProvider([a, b]);
        expect(await p.structured(schema, 'private', [])).toEqual({ ok: true });
        await p.structured(schema, 'private', []);
        expect(a.structured).toHaveBeenCalledTimes(1);
        expect(b.structured).toHaveBeenCalledTimes(2);
        expect(p.attempts).toHaveLength(3);
        expect(JSON.stringify(p.attempts)).not.toContain('private');
        expect(p.model).toBe(b.model);
      });
  for (const code of [
    'AI_REFUSED',
    'AI_REQUEST_INVALID',
    'AI_KEY_INVALID',
    'AI_ACCESS_DENIED',
    'AI_MODEL_UNAVAILABLE',
    'AI_INVALID_RESPONSE',
    'AI_INCOMPLETE',
  ])
    it(`does not route around ${code}`, async () => {
      const a = make('openai'),
        b = make('anthropic');
      a.structured.mockRejectedValue(new AppError(code));
      const p = new FallbackProvider([a, b]);
      await expect(p.structured(schema, '', [])).rejects.toMatchObject({
        code,
      });
      expect(b.structured).not.toHaveBeenCalled();
    });
  it('stops when both providers are unavailable', async () => {
    const a = make('openai'),
      b = make('anthropic');
    for (const p of [a, b])
      p.structured.mockRejectedValue(new AppError('AI_UNAVAILABLE'));
    const provider = new FallbackProvider([a, b]);
    await expect(provider.structured(schema, '', [])).rejects.toThrow();
    expect(provider.attempts).toHaveLength(2);
  });
  it('recognises credit errors without leaking upstream details', async () => {
    for (const [provider, status, error] of [
      [
        'openai',
        429,
        { code: 'insufficient_quota', message: 'private billing details' },
      ],
      [
        'anthropic',
        400,
        {
          type: 'invalid_request_error',
          message:
            'Your credit balance is too low to access the Anthropic API.',
        },
      ],
      ['anthropic', 402, {}],
    ] as const) {
      const result = await modelHttpError(
        provider,
        Response.json({ error }, { status }),
      );
      expect(result.code).toBe('AI_QUOTA_EXCEEDED');
      expect(result.message).not.toContain('private billing details');
    }
    expect(
      (
        await modelHttpError(
          'anthropic',
          Response.json(
            {
              error: {
                type: 'invalid_request_error',
                message: 'Invalid schema',
              },
            },
            { status: 400 },
          ),
        )
      ).code,
    ).toBe('AI_REQUEST_INVALID');
  });
});
describe('Claude structured output and files', () => {
  it('converts text, image and PDF without using public URLs', () => {
    const messages = claudeMessages([
      { role: 'user', content: 'hello' },
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/png;base64,YQ==' },
          { type: 'input_file', file_data: 'data:application/pdf;base64,Yg==' },
          { type: 'input_text', text: 'private CSV' },
        ],
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].content.map((x) => x.type)).toEqual([
      'text',
      'image',
      'document',
      'text',
    ]);
    expect(() =>
      claudeMessages([
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'https://example.com/private.png',
            },
          ],
        },
      ]),
    ).toThrow();
  });
  it('retains property names that resemble schema keywords', () => {
    const result = claudeSchema(
      z
        .object({ pattern: z.string().min(2), format: z.string().max(5) })
        .strict(),
    );
    expect(Object.keys(result.properties as object)).toEqual([
      'pattern',
      'format',
    ]);
    expect(JSON.stringify(result)).toContain('Required validation');
    expect(() => claudeSchema(AgentOutput)).not.toThrow();
  });
  it('uses Messages API schema, no execution tools, private key headers and usage metadata', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'private-test-key');
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              agents: ['social'],
              reason: 'draft',
              webSearch: false,
              searchQuery: null,
            }),
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          cache_read_input_tokens: 5,
        },
      }),
    );
    const provider = new ClaudeProvider();
    await provider.structured(RouteOutput, 'managed rules', [
      { role: 'user', content: 'A draft please' },
    ]);
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const payload = JSON.parse(options?.body as string);
    expect(payload.output_config.format.type).toBe('json_schema');
    expect(payload.tools).toBeUndefined();
    expect(payload.system).toBe('managed rules');
    expect(JSON.stringify(payload)).not.toContain('private-test-key');
    expect(provider.usage[0]).toMatchObject({
      provider: 'anthropic',
      inputTokens: 25,
      totalTokens: 35,
    });
  });
  for (const [stop, code] of [
    ['refusal', 'AI_REFUSED'],
    ['max_tokens', 'AI_INCOMPLETE'],
  ])
    it(`treats ${stop} as terminal, not a quota switch`, async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'test');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json({ stop_reason: stop, content: [] }),
      );
      await expect(
        new ClaudeProvider().structured(schema, '', []),
      ).rejects.toMatchObject({ code });
    });
  it('validates original constraints after the provider response', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"title":"x"}' }],
      }),
    );
    await expect(
      new ClaudeProvider().structured(
        z.object({ title: z.string().min(5) }).strict(),
        '',
        [],
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
});
