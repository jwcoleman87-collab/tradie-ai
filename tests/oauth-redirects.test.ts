import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  upsert: vi.fn(),
  rpc: vi.fn(),
  discoverAdsAccounts: vi.fn(),
}));

vi.mock('../lib/server/db', () => ({
  adminDb: () => ({
    from: () => ({ insert: mocks.insert, upsert: mocks.upsert }),
  }),
  checked: <T>(result: { data: T; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  rpc: mocks.rpc,
}));

vi.mock('../lib/server/google-ads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/google-ads')>()),
  discoverAdsAccounts: mocks.discoverAdsAccounts,
}));

import { finishGoogle, startGoogle } from '../lib/server/oauth';
import { finishProvider, startProvider } from '../lib/server/provider-oauth';

const origin = 'https://tradie.example';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'developer-token');
  vi.stubEnv('META_APP_ID', 'meta-app');
  vi.stubEnv('META_APP_SECRET', 'meta-secret');
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  vi.stubEnv('META_LOGIN_CONFIG_ID', 'meta-config');
  mocks.insert.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.upsert.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.rpc.mockReset();
  mocks.discoverAdsAccounts.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('OAuth start routes', () => {
  it('uses the Calendar callback and callback-scoped state cookie', async () => {
    const response = await startGoogle(workspaceId, userId);
    const target = new URL((await response.json()).url);

    expect(target.origin).toBe('https://accounts.google.com');
    expect(target.searchParams.get('redirect_uri')).toBe(
      `${origin}/api/google/callback`,
    );
    expect(response.headers.get('set-cookie')).toContain(
      'Path=/api/google/callback',
    );
  });

  it.each(['facebook', 'google_ads'] as const)(
    'uses the %s callback and callback-scoped state cookie',
    async (provider) => {
      const response = await startProvider(provider, workspaceId, userId);
      const target = new URL((await response.json()).url);

      expect(target.searchParams.get('redirect_uri')).toBe(
        `${origin}/api/integrations/${provider}/callback`,
      );
      expect(response.headers.get('set-cookie')).toContain(
        `Path=/api/integrations/${provider}/callback`,
      );
    },
  );
});

describe('OAuth callback routes', () => {
  it('returns a cancelled Calendar connection to workspace Connections', async () => {
    mocks.rpc.mockResolvedValue({
      workspace_id: workspaceId,
      user_id: userId,
      verifier: 'verifier',
      provider: 'google_calendar',
    });
    const response = await finishGoogle(
      new Request(
        `${origin}/api/google/callback?state=state&error=access_denied`,
        { headers: { cookie: 'tradie_oauth=nonce' } },
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}/workspace?calendar=cancelled`,
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('returns a connected Calendar to workspace Connections', async () => {
    mocks.rpc.mockResolvedValue({
      workspace_id: workspaceId,
      user_id: userId,
      verifier: 'verifier',
      provider: 'google_calendar',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        refresh_token: 'refresh-token',
        scope: 'https://www.googleapis.com/auth/calendar.events',
      }),
    );
    const response = await finishGoogle(
      new Request(`${origin}/api/google/callback?state=state&code=code`, {
        headers: { cookie: 'tradie_oauth=nonce' },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `${origin}/workspace?calendar=connected`,
    );
    expect(mocks.upsert).toHaveBeenCalledOnce();
  });

  it.each(['facebook', 'google_ads'] as const)(
    'returns a cancelled %s connection to workspace Connections',
    async (provider) => {
      mocks.rpc.mockResolvedValue({
        workspace_id: workspaceId,
        user_id: userId,
        verifier: 'verifier',
        provider,
      });
      const response = await finishProvider(
        provider,
        new Request(
          `${origin}/api/integrations/${provider}/callback?state=state&error=access_denied`,
          { headers: { cookie: `tradie_oauth_${provider}=nonce` } },
        ),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        `${origin}/workspace?connection=${provider}&status=cancelled`,
      );
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    },
  );

  it('returns Google Ads discovery to the workspace resource picker', async () => {
    mocks.rpc.mockResolvedValue({
      workspace_id: workspaceId,
      user_id: userId,
      verifier: 'verifier',
      provider: 'google_ads',
    });
    mocks.discoverAdsAccounts.mockResolvedValue({
      limited: false,
      resources: [
        {
          id: '1234567890',
          name: 'Example Ads account',
          currency: 'AUD',
          timeZone: 'Australia/Sydney',
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        scope: 'https://www.googleapis.com/auth/adwords',
      }),
    );
    const response = await finishProvider(
      'google_ads',
      new Request(
        `${origin}/api/integrations/google_ads/callback?state=state&code=code`,
        { headers: { cookie: 'tradie_oauth_google_ads=nonce' } },
      ),
    );
    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(303);
    expect(location.origin + location.pathname).toBe(`${origin}/workspace`);
    expect(location.searchParams.get('connection')).toBe('google_ads');
    expect(location.searchParams.get('status')).toBe('choose');
    expect(location.searchParams.get('candidate')).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.insert).toHaveBeenCalledOnce();
  });
});
