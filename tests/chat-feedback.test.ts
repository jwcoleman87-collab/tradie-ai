import { afterEach, expect, it, vi } from 'vitest';
import { chatBlockedReason, submitChat } from '../lib/chat-client';
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
