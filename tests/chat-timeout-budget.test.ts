import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FallbackProvider, createAIProvider } from '../lib/server/ai-provider';
import { OpenAIProvider, runTeam } from '../lib/server/ai';
import { AppError } from '../lib/server/errors';
import { CHAT_STAGE_MS } from '../lib/server/chat-budget';
import { RouteOutput } from '../lib/contracts';
import { aiProblem, timeoutCopyContext } from '../lib/ai-diagnostics';
import type { AIProviderName } from '../lib/ai-settings';

const schema = z.object({ ok: z.boolean() }).strict();
const routing = {
  agents: ['social'],
  reason: 'caption',
  calendarContext: false,
  webSearch: false,
  searchQuery: null,
};
const answer = {
  reply: 'A finished Facebook draft.',
  proposals: [],
  escalation: 'none',
};

const make = (name: AIProviderName) => ({
  name,
  model: name + '-test',
  structured: vi.fn().mockResolvedValue({ ok: true }),
  usage: [],
});

function captureTimeouts() {
  const timers: { milliseconds: number; controller: AbortController }[] = [];
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    timers.push({ milliseconds, controller });
    return controller.signal;
  });
  return timers;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('production Chat timeout budget', () => {
  it('lets a final response finish after 30s when it still fits the 45s response stage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
    const timers = captureTimeouts();
    const inner = make('openai');
    inner.structured
      .mockResolvedValueOnce(routing)
      .mockResolvedValueOnce(answer);
    const provider = new FallbackProvider([inner]);
    await expect(
      runTeam(provider, {
        history: [{ role: 'user', content: 'Draft a Facebook post' }],
        timeZone: 'Australia/Sydney',
      }),
    ).resolves.toMatchObject({ reply: answer.reply });
    expect(timers.some((timer) => timer.milliseconds === 30_000)).toBe(false);
    expect(
      timers.some((timer) => timer.milliseconds === CHAT_STAGE_MS.response),
    ).toBe(true);
    expect(inner.structured).toHaveBeenCalledTimes(2);
    const responseAttempt = inner.structured.mock.calls[1][3]
      .signal as AbortSignal;
    expect(responseAttempt.aborted).toBe(false);
    expect(provider.attempts.map((attempt) => attempt.step)).toEqual([
      'routing',
      'response',
    ]);
    expect(provider.attempts[1]).toMatchObject({
      attemptTimeoutMs: CHAT_STAGE_MS.response,
      backupEligible: false,
    });
  });

  it('records that the response attempt used the remaining 45s stage, not the generic 30s cap', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
    captureTimeouts();
    const inner = make('openai');
    const provider = new FallbackProvider([inner]);
    await provider.structured(schema, '', [], { deadlineAt: 46_000 });
    expect(provider.attempts[0]).toMatchObject({
      status: 'completed',
      attemptTimeoutMs: 45_000,
      stageRemainingMs: 45_000,
      backupEligible: false,
    });
    expect(inner.structured.mock.calls[0][3].signal.aborted).toBe(false);
  });

  it('still times out a final response that exceeds the 45s response stage', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
    const timers = captureTimeouts();
    const inner = make('openai');
    inner.structured
      .mockResolvedValueOnce(routing)
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = runTeam(new FallbackProvider([inner]), {
      history: [{ role: 'user', content: 'Draft a Facebook post' }],
      timeZone: 'Australia/Sydney',
    });
    await vi.waitFor(() => expect(inner.structured).toHaveBeenCalledTimes(2));
    const responseTimer = timers.find(
      (timer) => timer.milliseconds === CHAT_STAGE_MS.response,
    );
    expect(responseTimer).toBeDefined();
    expect(timers.some((timer) => timer.milliseconds === 30_000)).toBe(false);
    responseTimer!.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(inner.structured).toHaveBeenCalledTimes(2);
  });

  it('keeps routing on the 20s routing stage after the response budget is raised', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
    const timers = captureTimeouts();
    const inner = make('openai');
    inner.structured.mockImplementation(() => new Promise(() => {}));
    const pending = runTeam(new FallbackProvider([inner]), {
      history: [{ role: 'user', content: 'Draft a Facebook post' }],
      timeZone: 'Australia/Sydney',
    });
    const routingTimer = timers.find(
      (timer) => timer.milliseconds === CHAT_STAGE_MS.routing,
    );
    expect(routingTimer).toBeDefined();
    expect(
      timers.some((timer) => timer.milliseconds === CHAT_STAGE_MS.response),
    ).toBe(false);
    routingTimer!.controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(inner.structured).toHaveBeenCalledTimes(1);
  });

  it('gives the backup the remaining stage after a fast primary failure without extending the deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
    const timers = captureTimeouts();
    const a = make('openai');
    const b = make('anthropic');
    a.structured.mockRejectedValue(new AppError('AI_UNAVAILABLE', 503));
    b.structured.mockResolvedValue({ ok: true });
    const provider = new FallbackProvider([a, b]);
    await expect(
      provider.structured(schema, '', [], { deadlineAt: 46_000 }),
    ).resolves.toEqual({ ok: true });
    expect(a.structured).toHaveBeenCalledTimes(1);
    expect(b.structured).toHaveBeenCalledTimes(1);
    expect(b.structured.mock.calls[0][3].signal.aborted).toBe(false);
    expect(timers.every((timer) => timer.milliseconds <= 45_000)).toBe(true);
    expect(provider.attempts).toMatchObject([
      {
        provider: 'openai',
        status: 'failed',
        errorCode: 'AI_UNAVAILABLE',
        backupEligible: true,
        attemptTimeoutMs: 45_000,
      },
      {
        provider: 'anthropic',
        status: 'completed',
        backupEligible: false,
      },
    ]);
  });

  it('does not send Anthropic when fallback is enabled but only OpenAI is allowed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-claude');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        status: 'completed',
        output: [
          {
            content: [{ type: 'output_text', text: JSON.stringify(routing) }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    );
    const provider = createAIProvider({
      ai_primary_provider: 'openai',
      ai_fallback_enabled: true,
      ai_allowed_providers: ['openai'],
    });
    await provider.structured(RouteOutput, 'route', []);
    expect(fetchMock).toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.every(
        ([url]) => url === 'https://api.openai.com/v1/responses',
      ),
    ).toBe(true);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('anthropic');
    expect(provider.attempts).toHaveLength(1);
    expect(provider.attempts[0]).toMatchObject({
      provider: 'openai',
      status: 'completed',
      backupEligible: false,
    });
  });

  it('still forwards a trusted image attachment into the final response request', async () => {
    const inner = make('openai');
    inner.structured
      .mockResolvedValueOnce(routing)
      .mockResolvedValueOnce(answer);
    const image = {
      type: 'input_image',
      image_url: 'data:image/png;base64,YQ==',
    };
    await runTeam(new FallbackProvider([inner]), {
      history: [
        { role: 'user', content: 'Make a Facebook post from this photo' },
      ],
      timeZone: 'Australia/Sydney',
      attachments: [image],
    });
    const responseInput = inner.structured.mock.calls[1][2] as unknown[];
    expect(JSON.stringify(responseInput)).toContain('input_image');
    expect(JSON.stringify(responseInput)).toContain(
      'data:image/png;base64,YQ==',
    );
    expect(JSON.stringify(inner.structured.mock.calls[0][2])).not.toContain(
      'input_image',
    );
  });

  it('does not claim an unused backup in timeout copy when none is eligible', () => {
    expect(aiProblem('AI_TIMEOUT')).toBe(
      'The provider took too long to answer. Try again or use a shorter request.',
    );
    expect(
      aiProblem(
        'AI_TIMEOUT',
        timeoutCopyContext(
          {
            ai_primary_provider: 'openai',
            ai_fallback_enabled: true,
            ai_allowed_providers: ['openai'],
          },
          { openai: true, anthropic: false },
        ),
      ),
    ).toBe(
      'The provider took too long to answer. Try again or use a shorter request.',
    );
    expect(
      aiProblem(
        'AI_TIMEOUT',
        timeoutCopyContext(
          {
            ai_primary_provider: 'openai',
            ai_fallback_enabled: true,
            ai_allowed_providers: ['openai'],
          },
          { openai: true, anthropic: true },
        ),
      ),
    ).toContain('allow an available backup in Connections');
    expect(
      aiProblem(
        'AI_TIMEOUT',
        timeoutCopyContext(
          {
            ai_primary_provider: 'openai',
            ai_fallback_enabled: true,
            ai_allowed_providers: ['openai', 'anthropic'],
          },
          { openai: true, anthropic: true },
          [
            { provider: 'openai', status: 'failed' },
            { provider: 'anthropic', status: 'failed' },
          ],
        ),
      ),
    ).toBe(
      'The crew could not complete the response in time. Try again or use a shorter request.',
    );
  });
});

it('OpenAI adapter inherits the attempt signal instead of stacking a 30s timer', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.stubEnv('OPENAI_API_KEY', 'test-openai');
  vi.stubEnv('AI_REQUEST_TIMEOUT_MS', '30000');
  const timers = captureTimeouts();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'completed',
      output: [
        { content: [{ type: 'output_text', text: JSON.stringify(routing) }] },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
  );
  const attempt = new AbortController();
  await new OpenAIProvider().structured(RouteOutput, '', [], {
    signal: attempt.signal,
  });
  expect(timers.some((timer) => timer.milliseconds === 30_000)).toBe(false);
  expect(fetchMock.mock.calls[0][1]?.signal).toBe(attempt.signal);
});
