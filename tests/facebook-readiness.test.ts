import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionInfo } from '../lib/integrations';
import {
  facebookPreparationAvailable,
  facebookPublishingBlockReason,
  facebookPublishingUnavailableReason,
} from '../lib/facebook-readiness';
import { memoryDb } from './fixtures/memory-db';

const mocks = vi.hoisted(() => ({ db: {} as unknown }));
vi.mock('../lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/db')>()),
  adminDb: () => mocks.db,
}));
import { connectionList } from '../lib/server/connections';

const page: ConnectionInfo = {
  provider: 'facebook',
  configured: true,
  connectionId: '10000000-0000-4000-8000-000000000001',
  status: 'connected',
  externalId: '12345',
  displayName: 'Test Page',
  verifiedAt: null,
  lastErrorCode: null,
  lastErrorAt: null,
  capabilities: ['facebook.publish'],
};
beforeEach(() => {
  for (const name of [
    'TOKEN_ENCRYPTION_KEY',
    'APP_ORIGIN',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_LOGIN_CONFIG_ID',
  ])
    vi.stubEnv(name, 'configured');
  vi.stubEnv('META_GRAPH_VERSION', 'v26.0');
  mocks.db = memoryDb({
    integration_credentials: [
      {
        workspace_id: 'workspace-a',
        provider: 'facebook',
        connection_id: page.connectionId,
        external_id: page.externalId,
        display_name: page.displayName,
        status: 'connected',
        last_error_code: null,
      },
    ],
  }).db;
});
afterEach(() => vi.unstubAllEnvs());

it.each(['true', 'false'])(
  'returns exact readiness when the operator switch is %s',
  async (enabled) => {
    vi.stubEnv('FACEBOOK_PUBLISHING_ENABLED', enabled);
    const facebook = (await connectionList('workspace-a')).find(
      (c) => c.provider === 'facebook',
    )!;
    expect(facebookPreparationAvailable(facebook)).toBe(true);
    expect(facebook.capabilities).toEqual(
      enabled === 'true' ? ['facebook.publish'] : [],
    );
    expect(facebook.publishingUnavailableReason).toBe(
      enabled === 'true' ? null : 'operator_disabled',
    );
    if (enabled === 'true')
      expect(facebookPublishingBlockReason(facebook)).toBeNull();
    else
      expect(facebookPublishingBlockReason(facebook)).toContain(
        'reconnecting this Page will not enable it',
      );
  },
);

it.each([
  [{ configured: false }, 'not_configured'],
  [{ status: 'not_connected' }, 'not_connected'],
  [{ connectionId: null }, 'not_connected'],
  [{ externalId: 'invented-page' }, 'not_connected'],
  [{ status: 'reconnect_required' }, 'reconnect_required'],
  [{ lastErrorCode: 'FACEBOOK_PERMISSIONS_REQUIRED' }, 'permissions_required'],
  [{ lastErrorCode: 'FACEBOOK_CHECK_FAILED' }, 'connection_issue'],
  [{ provider: 'google_calendar' }, 'not_connected'],
] as const)(
  'does not allow preparation for invalid Page state %j',
  (changes, reason) => {
    const connection = { ...page, ...changes } as ConnectionInfo;
    expect(facebookPreparationAvailable(connection)).toBe(false);
    expect(facebookPublishingUnavailableReason(connection)).toBe(reason);
    expect(facebookPublishingBlockReason(connection)).toBeTruthy();
  },
);

it('does not mistake a missing connection for an operator-disabled Page', () => {
  expect(facebookPreparationAvailable()).toBe(false);
  expect(facebookPublishingUnavailableReason()).toBe('not_connected');
});
