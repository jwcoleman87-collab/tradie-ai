import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  calendarContext,
  invalidateCalendarTokenCache,
  verifyCalendarConnection,
} from '../lib/server/calendar';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  decrypt: vi.fn(),
  demote: vi.fn(),
  verified: vi.fn(),
}));
vi.mock('../lib/server/db', () => ({
  adminDb: () => ({ from: mocks.from }),
  checked: (value: { data: unknown; error: unknown }) => {
    if (value.error) throw value.error;
    return value.data;
  },
}));
vi.mock('../lib/server/crypto', () => ({ decrypt: mocks.decrypt }));
vi.mock('../lib/server/connections', () => ({
  markConnectionReconnectRequired: mocks.demote,
  recordConnectionVerification: mocks.verified,
}));

const workspaceId = crypto.randomUUID();
let connectionId: string;
let credential: string;
let connected: boolean;
let expiresIn: number;
let tokenCalls: number;
let eventCalls: number;
beforeEach(() => {
  invalidateCalendarTokenCache(workspaceId);
  connectionId = crypto.randomUUID();
  credential = 'encrypted-test';
  connected = true;
  expiresIn = 3600;
  tokenCalls = 0;
  eventCalls = 0;
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test');
  mocks.decrypt.mockReset().mockResolvedValue('test-refresh-token');
  mocks.demote.mockReset().mockResolvedValue(undefined);
  mocks.verified.mockReset().mockResolvedValue(undefined);
  mocks.from.mockImplementation(() => {
    let recheck = false;
    let pinned: string | undefined;
    const query = {
      select: () => query,
      in: (_column: string, statuses: string[]) => {
        recheck = statuses.includes('reconnect_required');
        return query;
      },
      eq: (column: string, value: string) => {
        if (column === 'connection_id') pinned = value;
        return query;
      },
      maybeSingle: async () => ({
        data:
          (connected || recheck) && (!pinned || pinned === connectionId)
            ? {
                connection_id: connectionId,
                encrypted_refresh_token: credential,
              }
            : null,
        error: null,
      }),
    };
    return query;
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const target =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (target.includes('oauth2.googleapis.com')) {
      tokenCalls++;
      return Response.json({
        access_token: 'test-access-token',
        expires_in: expiresIn,
      });
    }
    eventCalls++;
    return Response.json({ items: [] });
  });
});
afterEach(() => {
  invalidateCalendarTokenCache(workspaceId);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('reuses only the access token while retrieving fresh availability for each request', async () => {
  await calendarContext(workspaceId);
  await calendarContext(workspaceId);
  expect(tokenCalls).toBe(1);
  expect(eventCalls).toBe(2);
  expect(mocks.from).toHaveBeenCalledTimes(2);
});

it('isolates tokens by connection and encrypted credential and invalidates explicit reconnects', async () => {
  await calendarContext(workspaceId);
  connectionId = crypto.randomUUID();
  await calendarContext(workspaceId);
  credential = 'replacement-encrypted-credential';
  await calendarContext(workspaceId);
  invalidateCalendarTokenCache(workspaceId);
  await calendarContext(workspaceId);
  expect(tokenCalls).toBe(4);
});

it('does not use a cached token after a disconnect observed in another server process', async () => {
  await calendarContext(workspaceId);
  connected = false;
  expect(await calendarContext(workspaceId)).toMatchObject({
    available: false,
  });
  expect(tokenCalls).toBe(1);
  expect(eventCalls).toBe(1);
});

it('checks only the same pinned Calendar connection used to prepare a proposal', async () => {
  expect(
    await calendarContext(workspaceId, undefined, crypto.randomUUID()),
  ).toMatchObject({ available: false });
  expect(tokenCalls).toBe(0);
  expect(eventCalls).toBe(0);
});

it('allows a pinned read-only health recheck to restore a previously demoted connection', async () => {
  connected = false;
  await verifyCalendarConnection(workspaceId, connectionId);
  expect(tokenCalls).toBe(1);
  expect(mocks.verified).toHaveBeenCalledWith(
    workspaceId,
    'google_calendar',
    connectionId,
    expect.anything(),
  );
});

it.each([
  [400, 'invalid_client', 'GOOGLE_CALENDAR_CONFIGURATION_REQUIRED'],
  [400, 'temporarily_unavailable', 'UPSTREAM_UNAVAILABLE'],
  [429, 'rate_limited', 'PROVIDER_RATE_LIMITED'],
  [400, 'unknown_error', 'GOOGLE_CALENDAR_CHECK_FAILED'],
])(
  'retains Calendar credentials after token HTTP%s %s',
  async (status, error, code) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error }, { status: Number(status) }),
    );
    await expect(
      verifyCalendarConnection(workspaceId, connectionId),
    ).rejects.toMatchObject({ code });
    expect(mocks.demote).not.toHaveBeenCalled();
  },
);

it('requires reconnect only after confirmed invalid_grant and retains malformed-success credentials', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'invalid_grant' }, { status: 400 }),
  );
  await expect(
    verifyCalendarConnection(workspaceId, connectionId),
  ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  expect(mocks.demote).toHaveBeenCalled();
  mocks.demote.mockClear();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}));
  await expect(
    verifyCalendarConnection(workspaceId, connectionId),
  ).rejects.toMatchObject({ code: 'CALENDAR_CHECK_FAILED' });
  expect(mocks.demote).not.toHaveBeenCalled();
});

it('refreshes before token expiry and never caches a nearly expired token', async () => {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await calendarContext(workspaceId);
  clock.mockReturnValue(now + 3550_000);
  await calendarContext(workspaceId);
  expect(tokenCalls).toBe(2);
  invalidateCalendarTokenCache(workspaceId);
  expiresIn = 30;
  await calendarContext(workspaceId);
  await calendarContext(workspaceId);
  expect(tokenCalls).toBe(4);
});

it('does not repopulate the token cache from a refresh already in flight during disconnect', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => {
    tokenCalls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = calendarContext(workspaceId);
  await vi.waitFor(() => expect(tokenCalls).toBe(1));
  invalidateCalendarTokenCache(workspaceId);
  finish(
    Response.json({ access_token: 'test-access-token', expires_in: 3600 }),
  );
  await pending;
  await calendarContext(workspaceId);
  expect(tokenCalls).toBe(2);
});
