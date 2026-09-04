import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}));
vi.mock('../lib/server/db', () => ({
  adminDb: () => ({
    from: () => {
      let update: Record<string, unknown> | undefined;
      const query = {
        select: () => query,
        eq: () => query,
        update: (value: Record<string, unknown>) => {
          update = value;
          return query;
        },
        maybeSingle: async () => ({ data: store.row, error: null }),
        // Match the Supabase query builder, which commits updates when awaited.
        // oxlint-disable-next-line unicorn/no-thenable
        then: (resolve: (value: unknown) => unknown) => {
          if (update) {
            store.updates.push(update);
            Object.assign(store.row, update);
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return query;
    },
  }),
  checked: <T>(result: { data: T; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

import { verifyFacebookConnection } from '../lib/server/facebook';
import { verifyGoogleAdsConnection } from '../lib/server/google-ads';
import {
  credentialContext,
  providerCredentials,
} from '../lib/server/connections';
import { encrypt } from '../lib/server/crypto';

const workspace = '11111111-1111-4111-8111-111111111111';
const connection = '22222222-2222-4222-8222-222222222222';
beforeEach(async () => {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('META_APP_SECRET', 'test-secret');
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'test-dev-token');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret');
  store.updates = [];
  await saved('facebook');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function saved(
  provider: 'facebook' | 'google_ads',
  status = 'connected',
) {
  const id = provider === 'facebook' ? '12345' : '1234567890';
  store.row = {
    connection_id: connection,
    external_id: id,
    credential_kind: 'provider_json_v1',
    status,
    verified_at: '2026-09-01T00:00:00Z',
    encrypted_refresh_token: await encrypt(
      JSON.stringify({
        token: 'saved-token',
        resource: { id, name: 'Selected account' },
        scopes: [],
      }),
      credentialContext(workspace, provider, connection),
    ),
  };
}

it('does not persistently demote a valid Facebook connection after a throttle', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 4, is_transient: true } }, { status: 400 }),
  );
  await expect(
    verifyFacebookConnection(workspace, connection),
  ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
  expect(store.row.status).toBe('connected');
  expect(store.updates).toEqual([]);
});

it('read-only checking restores previously demoted Facebook credentials after a successful Page read', async () => {
  await saved('facebook', 'reconnect_required');
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ id: '12345', name: 'Page restored' }));
  await expect(
    providerCredentials(workspace, 'facebook', connection),
  ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  await verifyFacebookConnection(workspace, connection);
  expect(store.row).toMatchObject({
    status: 'connected',
    display_name: 'Page restored',
    last_error_code: null,
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
});

it('keeps a previously demoted connection unchanged if its read-only recheck is temporary', async () => {
  await saved('facebook', 'reconnect_required');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 2, is_transient: true } }, { status: 400 }),
  );
  await expect(
    verifyFacebookConnection(workspace, connection),
  ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  expect(store.row.status).toBe('reconnect_required');
  expect(store.updates).toEqual([]);
});

it('requires reconnect only on confirmed Facebook token rejection', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 190 } }, { status: 400 }),
  );
  await expect(
    verifyFacebookConnection(workspace, connection),
  ).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  expect(store.row).toMatchObject({
    status: 'reconnect_required',
    last_error_code: 'FACEBOOK_ACCESS_REVOKED',
  });
  expect(store.row.encrypted_refresh_token).toEqual(expect.any(String));
});

it('never clears a confirmed publishing-permission failure using a Page name read', async () => {
  await saved('facebook', 'reconnect_required');
  store.row.last_error_code = 'FACEBOOK_PERMISSIONS_REQUIRED';
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(
      verifyFacebookConnection(workspace, connection),
    ).rejects.toMatchObject({ code: 'FACEBOOK_PERMISSIONS_REQUIRED' });
  expect(store.updates).toEqual([]);
  expect(store.row.last_error_code).toBe('FACEBOOK_PERMISSIONS_REQUIRED');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('retains Google Ads authorization while flagging account access that must be restored', async () => {
  await saved('google_ads');
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            details: [
              {
                errors: [
                  {
                    errorCode: { authorizationError: 'USER_PERMISSION_DENIED' },
                  },
                ],
              },
            ],
          },
        },
        { status: 403 },
      ),
    );
  await expect(
    verifyGoogleAdsConnection(workspace, connection),
  ).rejects.toMatchObject({ code: 'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED' });
  expect(store.row).toMatchObject({
    status: 'connected',
    verified_at: null,
    last_error_code: 'GOOGLE_ADS_ACCOUNT_ACCESS_REQUIRED',
  });
  expect(store.row.encrypted_refresh_token).toEqual(expect.any(String));
});

it('does not mark Ads authorization revoked for invalid application credentials', async () => {
  await saved('google_ads');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ error: 'invalid_client' }, { status: 400 }),
  );
  await expect(
    verifyGoogleAdsConnection(workspace, connection),
  ).rejects.toMatchObject({ code: 'GOOGLE_ADS_CONFIGURATION_REQUIRED' });
  expect(store.row).toMatchObject({
    status: 'connected',
    verified_at: null,
    last_error_code: 'GOOGLE_ADS_CONFIGURATION_REQUIRED',
  });
});
