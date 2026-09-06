import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  rpc: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));
vi.mock('../lib/server/db', () => ({
  adminDb: () => ({
    from: () => {
      const query = {
        insert: mocks.insert,
        select: () => query,
        eq: () => query,
        gt: () => query,
        order: () => query,
        limit: async () => ({ data: mocks.rows, error: null }),
      };
      return query;
    },
  }),
  checked: <T>(result: { data: T; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  rpc: mocks.rpc,
}));
import {
  finishProvider,
  pendingConnections,
} from '../lib/server/provider-oauth';
import { decrypt } from '../lib/server/crypto';
import { credentialContext } from '../lib/server/connections';

const workspace = '11111111-1111-4111-8111-111111111111';
const grants = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
];
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://workbench.example');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('META_APP_ID', 'test-app');
  vi.stubEnv('META_APP_SECRET', 'test-secret');
  vi.stubEnv('META_GRAPH_VERSION', 'v25.0');
  mocks.insert.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.rows = [];
  mocks.rpc.mockReset().mockResolvedValue({
    workspace_id: workspace,
    user_id: '22222222-2222-4222-8222-222222222222',
    verifier: 'verifier',
    provider: 'facebook',
    generation: 1,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function responses(
  tasks: string[],
  token: string | undefined = 'page-token',
  permissions = grants,
) {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ access_token: 'short-token' }))
    .mockResolvedValueOnce(Response.json({ access_token: 'long-token' }))
    .mockResolvedValueOnce(
      Response.json({
        data: permissions.map((permission) => ({
          permission,
          status: 'granted',
        })),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        data: [
          { id: '12345', name: 'Modern Page', tasks, access_token: token },
        ],
      }),
    );
}
function callback() {
  return finishProvider(
    'facebook',
    new Request(
      'https://workbench.example/api/integrations/facebook/callback?state=state&code=code',
      {
        headers: { cookie: 'tradie_oauth_facebook=nonce' },
      },
    ),
  );
}

it.each([
  'CREATE_CONTENT',
  'MANAGE',
  'PROFILE_PLUS_CREATE_CONTENT',
  'PROFILE_PLUS_MANAGE',
  'PROFILE_PLUS_FULL_CONTROL',
])('offers a Page with documented publishing task %s', async (task) => {
  responses([task]);
  const result = await callback();
  expect(result.status).toBe(303);
  expect(result.headers.get('location')).toContain('status=choose');
  const candidate = mocks.insert.mock.calls[0][0];
  const secrets = JSON.parse(
    await decrypt(
      candidate.ciphertext,
      credentialContext(workspace, 'facebook', candidate.id),
    ),
  );
  expect(secrets.resources).toEqual([
    { id: '12345', name: 'Modern Page', token: 'page-token' },
  ]);
  expect(result.headers.get('location')).not.toContain('page-token');
});
it.each(
  [
    [],
    ['ADVERTISE'],
    ['PROFILE_PLUS_ANALYZE'],
    ['PROFILE_PLUS_MODERATE'],
    ['PROFILE_PLUS_FACEBOOK_ACCESS'],
    ['NEW_UNKNOWN_TASK'],
  ].map((tasks) => ({ tasks })),
)('rejects insufficient or unknown Page tasks $tasks', async ({ tasks }) => {
  responses(tasks);
  await expect(callback()).rejects.toMatchObject({
    code: 'NO_ELIGIBLE_RESOURCES',
  });
  expect(mocks.insert).not.toHaveBeenCalled();
});
it('still requires the Page token even with modern full control', async () => {
  responses(['PROFILE_PLUS_FULL_CONTROL'], '');
  await expect(callback()).rejects.toMatchObject({
    code: 'NO_ELIGIBLE_RESOURCES',
  });
  expect(mocks.insert).not.toHaveBeenCalled();
});
it('still requires all publishing scopes before discovering Pages', async () => {
  responses(['PROFILE_PLUS_FULL_CONTROL'], 'page-token', ['pages_show_list']);
  await expect(callback()).rejects.toMatchObject({
    code: 'FACEBOOK_PERMISSIONS_REQUIRED',
  });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it('carries an incomplete Ads discovery notice through encrypted candidate storage to the picker', async () => {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'developer-token');
  mocks.rpc.mockResolvedValue({
    workspace_id: workspace,
    user_id: 'user',
    verifier: 'verifier',
    provider: 'google_ads',
    generation: 1,
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const value =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (value.includes('oauth2.googleapis.com'))
      return Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        scope: 'https://www.googleapis.com/auth/adwords',
      });
    if (value.includes('listAccessibleCustomers'))
      return Response.json({
        resourceNames: ['customers/1111111111', 'customers/2222222222'],
      });
    if (value.includes('1111111111'))
      return Response.json(
        {
          error: {
            details: [
              {
                errors: [
                  { errorCode: { authorizationError: 'CUSTOMER_NOT_ENABLED' } },
                ],
              },
            ],
          },
        },
        { status: 403 },
      );
    return Response.json({
      results: [
        {
          customerClient: {
            id: '2222222222',
            currencyCode: 'AUD',
            timeZone: 'Australia/Sydney',
            manager: false,
          },
        },
      ],
    });
  });
  await finishProvider(
    'google_ads',
    new Request(
      'https://workbench.example/api/integrations/google_ads/callback?state=state&code=code',
      {
        headers: { cookie: 'tradie_oauth_google_ads=nonce' },
      },
    ),
  );
  const candidate = mocks.insert.mock.calls[0][0];
  mocks.rows = [{ ...candidate, expires_at: '2099-01-01T00:00:00Z' }];
  const pending = await pendingConnections(workspace, 'user');
  expect(pending).toEqual([
    expect.objectContaining({
      incomplete: true,
      limited: false,
      resources: [expect.objectContaining({ id: '2222222222' })],
    }),
  ]);
  expect(JSON.stringify(pending)).not.toMatch(
    /refresh-token|access-token|ciphertext/,
  );
});
