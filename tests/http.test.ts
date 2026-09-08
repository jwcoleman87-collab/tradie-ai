import { it, expect, vi } from 'vitest';
import { endpoint, body } from '../lib/server/http';
import { publicConfig } from '../lib/server/config';
import { AppError } from '../lib/server/errors';
it('returns the server quota reset delay without weakening private API headers', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await endpoint(async () => {
      throw new AppError(
        'CHAT_BURST_LIMIT',
        429,
        'Wait until the next minute.',
        42,
      );
    })(new Request('https://example.test/api/chat'));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await response.json()).toMatchObject({
      error: { code: 'CHAT_BURST_LIMIT', retryAfterSeconds: 42 },
    });
  } finally {
    spy.mockRestore();
  }
});
it('rejects non-JSON requests', async () =>
  await expect(
    body(
      new Request('https://example.test/api/chat', {
        method: 'POST',
        body: '{}',
      }),
    ),
  ).rejects.toThrow());
it('bounds request size even without a Content-Length', async () =>
  await expect(
    body(
      new Request('https://example.test/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'a'.repeat(49000) }),
      }),
    ),
  ).rejects.toThrow());
it('fails closed on invalid JSON', async () =>
  await expect(
    body(
      new Request('https://example.test/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    ),
  ).rejects.toThrow());
it('does not expose customer or provider errors', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await endpoint(async () => {
      throw Error('secret customer transcript');
    })(new Request('https://example.test/api/state'));
    expect(await response.text()).not.toContain('secret customer');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret customer');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  } finally {
    spy.mockRestore();
  }
});
it('rejects cross-origin mutation', async () => {
  process.env.APP_ORIGIN = 'https://app.test';
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const handler = vi.fn();
    const response = await endpoint(handler)(
      new Request('https://app.test/api/chat', {
        method: 'POST',
        headers: { Origin: 'https://evil.test' },
      }),
    );
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  } finally {
    delete process.env.APP_ORIGIN;
    spy.mockRestore();
  }
});
it('never returns privileged keys in public config', () => {
  process.env.SUPABASE_ANON_KEY = 'sb_secret_test';
  try {
    expect(() => publicConfig()).toThrow();
  } finally {
    delete process.env.SUPABASE_ANON_KEY;
  }
});
