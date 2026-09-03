import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPrimaryCalendar } from '../lib/server/calendar';
import { googleAdsAccess } from '../lib/server/connections';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('provider connection health', () => {
  it('identifies the selected primary Calendar without changing it', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        summary: 'greenvac@gmail.com',
        timeZone: 'Australia/Sydney',
      }),
    );

    await expect(readPrimaryCalendar('access-token')).resolves.toEqual({
      summary: 'greenvac@gmail.com',
      timeZone: 'Australia/Sydney',
    });
    const [url, options] = request.mock.calls[0];
    const requestedUrl =
      typeof url === 'string'
        ? url
        : url instanceof URL
          ? url.href
          : url.url;
    expect(requestedUrl).toContain('/calendars/primary/events?');
    expect(requestedUrl).toContain('maxResults=1');
    expect(options?.method).toBeUndefined();
  });

  it('asks for reconnection only when Google rejects authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({}, { status: 401 }),
    );

    await expect(readPrimaryCalendar('expired-token')).rejects.toMatchObject({
      code: 'RECONNECT_REQUIRED',
      status: 409,
    });
  });

  it('treats a temporary provider failure as retryable, not revoked access', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({}, { status: 503 }),
    );

    await expect(readPrimaryCalendar('valid-token')).rejects.toMatchObject({
      code: 'CALENDAR_CHECK_FAILED',
      status: 503,
    });
  });

  it('does not demand an Ads reconnect for a temporary token-service outage', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({}, { status: 503 }),
    );

    await expect(googleAdsAccess('refresh-token')).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      status: 503,
    });
  });

  it('requests an Ads reconnect when Google rejects the refresh token', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({}, { status: 400 }),
    );

    await expect(googleAdsAccess('revoked-token')).rejects.toMatchObject({
      code: 'RECONNECT_REQUIRED',
      status: 409,
    });
  });
});
