import { afterEach, expect, it, vi } from 'vitest';
import { chatBlockedReason, chatStatus, submitChat } from '../lib/chat-client';
import { aiProblem } from '../lib/ai-diagnostics';
afterEach(() => vi.restoreAllMocks());
const input = { requestId: crypto.randomUUID(), text: 'A private test' };
for (const status of ['completed', 'failed', 'working']) {
  it(`clears a confirmed saved ${status} message, including failure receipts`, async () => {
    const onSaved = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          status,
          runId: crypto.randomUUID(),
          messageSaved: true,
          ...(status === 'failed'
            ? { error: { code: 'AI_TIMEOUT', message: 'Timed out' } }
            : {}),
        },
        { status: status === 'failed' ? 503 : 200 },
      ),
    );
    const result = await submitChat('test', input, onSaved);
    expect(result.status).toBe(status);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
}
it('preserves unsaved text and the request identity after a network failure', async () => {
  const onSaved = vi.fn();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new TypeError('network'));
  await expect(submitChat('test', input, onSaved)).rejects.toThrow();
  await expect(submitChat('test', input, onSaved)).rejects.toThrow();
  expect(onSaved).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][1]?.body).toBe(
    fetchMock.mock.calls[1][1]?.body,
  );
});
it('does not clear text on pre-save rejection or malformed receipts', async () => {
  const onSaved = vi.fn();
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { code: 'AI_CONSENT_REQUIRED', message: 'Enable AI' } },
        { status: 403 },
      ),
    );
  await expect(submitChat('test', input, onSaved)).rejects.toThrow();
  fetchMock.mockResolvedValue(Response.json({ status: 'completed' }));
  await expect(submitChat('test', input, onSaved)).rejects.toThrow();
  expect(onSaved).not.toHaveBeenCalled();
});
it('explains paused processing beside the composer and respects provider consent', () => {
  const prefs = {
    ai_consent_at: null,
    ai_primary_provider: 'openai' as const,
    ai_fallback_enabled: true,
    ai_allowed_providers: ['openai' as const],
  };
  expect(
    chatBlockedReason(true, prefs, { openai: true, anthropic: true }, false),
  ).toContain('AI processing is off');
  const enabled = { ...prefs, ai_consent_at: new Date().toISOString() };
  expect(
    chatBlockedReason(true, enabled, { openai: false, anthropic: true }, false),
  ).toContain('No permitted');
  expect(
    chatBlockedReason(true, enabled, { openai: true, anthropic: true }, false),
  ).toBe('');
  expect(
    chatBlockedReason(true, enabled, { openai: true, anthropic: true }, true),
  ).toContain('Please wait');
});
it('does not diagnose unknown AI_UNAVAILABLE failures as insufficient credit', () => {
  expect(aiProblem('AI_UNAVAILABLE')).toContain('does not establish');
  expect(aiProblem('AI_TRANSPORT_CONFIG_INVALID')).toContain(
    'adding credits will not fix',
  );
});

it('acknowledges a streamed saved message before generation finishes, then reads fragmented UTF-8 and progress', async () => {
  const runId = crypto.randomUUID();
  const onSaved = vi.fn(),
    onProgress = vi.fn();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    }),
  );
  let completed = false;
  const result = submitChat('test', input, onSaved, onProgress).then(
    (receipt) => {
      completed = true;
      return receipt;
    },
  );
  writer.enqueue(
    encoder.encode(
      JSON.stringify({
        type: 'accepted',
        status: 'working',
        runId,
        messageSaved: true,
      }) + '\n',
    ),
  );
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(completed).toBe(false);
  const assistantMessage = {
    id: crypto.randomUUID(),
    run_id: runId,
    role: 'assistant',
    content: 'Ready — café ☕',
    created_at: new Date().toISOString(),
    attachment_ids: [],
  };
  const bytes = encoder.encode(
    JSON.stringify({ type: 'progress', runId, stage: 'response' }) +
      '\n' +
      JSON.stringify({
        type: 'completed',
        status: 'completed',
        runId,
        messageSaved: true,
        assistantMessage,
      }) +
      '\n',
  );
  for (const byte of bytes) writer.enqueue(new Uint8Array([byte]));
  writer.close();
  await expect(result).resolves.toMatchObject({
    status: 'completed',
    assistantMessage,
  });
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onProgress).toHaveBeenCalledWith({ runId, stage: 'response' });
});

it('keeps the accepted receipt after a dropped stream so polling can recover the same request', async () => {
  const runId = crypto.randomUUID();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
  );
  const onSaved = vi.fn();
  const promise = submitChat('test', input, onSaved);
  writer.enqueue(
    new TextEncoder().encode(
      JSON.stringify({
        type: 'accepted',
        status: 'working',
        runId,
        messageSaved: true,
      }) + '\n',
    ),
  );
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  writer.error(new TypeError('network dropped'));
  await expect(promise).resolves.toMatchObject({ status: 'working', runId });
  fetchMock.mockResolvedValue(
    Response.json({
      status: 'failed',
      runId,
      messageSaved: true,
      error: { code: 'INTERRUPTED' },
    }),
  );
  await expect(
    chatStatus('test', 'workspace', input.requestId),
  ).resolves.toMatchObject({
    status: 'failed',
    error: { code: 'INTERRUPTED' },
  });
  expect(fetchMock.mock.calls[1][0]).toEqual(
    expect.stringContaining(`requestId=${input.requestId}`),
  );
  expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
});

it('never treats a progress event or an invalid run ID as durable acceptance', async () => {
  const onSaved = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ type: 'progress', stage: 'routing' }) +
        '\n' +
        JSON.stringify({
          type: 'accepted',
          status: 'working',
          runId: '-'.repeat(36),
          messageSaved: true,
        }) +
        '\n',
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    ),
  );
  await expect(submitChat('test', input, onSaved)).rejects.toThrow(
    'receipt could not be confirmed',
  );
  expect(onSaved).not.toHaveBeenCalled();
});

it('ignores mismatched progress and falls back to the saved run on a different-run final receipt', async () => {
  const runId = crypto.randomUUID();
  const onProgress = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      [
        { type: 'accepted', status: 'working', runId, messageSaved: true },
        { type: 'progress', stage: 'response', runId: crypto.randomUUID() },
        {
          type: 'completed',
          status: 'completed',
          runId: crypto.randomUUID(),
          messageSaved: true,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    ),
  );
  await expect(
    submitChat('test', input, () => {}, onProgress),
  ).resolves.toMatchObject({ status: 'working', runId });
  expect(onProgress).not.toHaveBeenCalled();
});

it('rejects receipts for another request before clearing the draft or accepting polled completion', async () => {
  const onSaved = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      status: 'completed',
      runId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      messageSaved: true,
    }),
  );
  await expect(submitChat('test', input, onSaved)).rejects.toThrow(
    'receipt could not be confirmed',
  );
  expect(onSaved).not.toHaveBeenCalled();
  await expect(
    chatStatus('test', 'workspace', input.requestId),
  ).rejects.toThrow('did not match');
});

it('keeps a confirmed receipt when optional browser timing diagnostics are unavailable', async () => {
  const onSaved = vi.fn();
  vi.spyOn(performance, 'measure').mockImplementation(() => {
    throw new Error('Unsupported timing options');
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'completed',
      runId: crypto.randomUUID(),
      messageSaved: true,
    }),
  );
  await expect(submitChat('test', input, onSaved)).resolves.toMatchObject({
    status: 'completed',
    messageSaved: true,
  });
  expect(onSaved).toHaveBeenCalledOnce();
});
