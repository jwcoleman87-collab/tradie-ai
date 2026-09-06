import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApi } from '../lib/server/api';
import { AppError } from '../lib/server/errors';
import { memoryDb } from './fixtures/memory-db';

const mocks = vi.hoisted(() => ({
  db: {} as unknown,
  rpc: vi.fn(),
  execute: vi.fn(),
  membership: vi.fn(),
}));
vi.mock('../lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/db')>()),
  adminDb: () => mocks.db,
  authenticate: async () => ({ db: mocks.db, user: { id: 'owner' } }),
  membership: mocks.membership,
  rpc: mocks.rpc,
}));
vi.mock('../lib/server/actions', () => ({ executeAction: mocks.execute }));
vi.mock('../lib/server/integration-api', () => ({
  integrationApi: async () => null,
}));
vi.mock('../lib/server/onboarding-api', () => ({
  onboardingApi: async () => null,
}));
const id = crypto.randomUUID();
const approved = {
  id,
  workspace_id: 'workspace-a',
  status: 'approved',
  approved_at: '2026-09-05T01:00:00Z',
  execution_token: 'PRIVATE',
  approved_by: 'PRIVATE',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = memoryDb({ proposed_actions: [approved] }).db;
  mocks.membership.mockResolvedValue('owner');
  mocks.rpc.mockResolvedValue(approved);
  mocks.execute.mockResolvedValue({
    id,
    status: 'completed',
    executed_at: '2026-09-05T01:00:02Z',
    execution_result: { url: 'https://www.facebook.com/123_456' },
  });
});
afterEach(() => vi.unstubAllEnvs());
const request = (signal?: AbortSignal, decision = 'accept') =>
  new Request(`https://example.test/api/actions/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
    signal,
  });

it('one approval request starts and completes execution without a second browser request', async () => {
  const keepAlive = vi.fn();
  const response = await createApi(keepAlive)(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'completed',
    executed_at: '2026-09-05T01:00:02Z',
  });
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(id, 'owner');
  expect(keepAlive).toHaveBeenCalledExactlyOnceWith(
    mocks.execute.mock.results[0].value,
  );
});
it('continues the same approved work after the browser disconnects', async () => {
  const cancellation = new AbortController();
  mocks.rpc.mockImplementation(async () => {
    cancellation.abort();
    return approved;
  });
  const keepAlive = vi.fn();
  const response = await createApi(keepAlive)(request(cancellation.signal));
  expect(response.status).toBe(200);
  expect(mocks.execute).toHaveBeenCalledOnce();
  expect(keepAlive).toHaveBeenCalledOnce();
});
for (const status of ['denied', 'expired', 'completed', 'executing', 'failed'])
  it(`does not auto-execute a ${status} approval replay or expose internal fields`, async () => {
    mocks.rpc.mockResolvedValue({ ...approved, status });
    const response = await createApi()(
      request(undefined, status === 'denied' ? 'deny' : 'accept'),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    const receipt = await response.text();
    expect(receipt).toContain(status);
    expect(receipt).not.toContain('PRIVATE');
    expect(receipt).not.toContain('execution_token');
  });
it('leaves saved approval recoverable if execution startup fails', async () => {
  mocks.execute.mockRejectedValue(new AppError('DATABASE_ERROR', 503));
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await createApi()(request());
    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      mocks.db,
      'decide_action',
      { p_action: id, p_user: 'owner', p_decision: 'accept' },
    );
    expect(approved.status).toBe('approved');
  } finally {
    logging.mockRestore();
  }
});
it('checks owner authority before recording approval or executing', async () => {
  mocks.membership.mockRejectedValue(new AppError('OWNER_REQUIRED', 403));
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await createApi()(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  } finally {
    logging.mockRestore();
  }
});

it('keeps a blocked Facebook proposal waiting for review when a stale browser tries to approve it', async () => {
  vi.stubEnv('FACEBOOK_PUBLISHING_ENABLED', 'false');
  mocks.db = memoryDb({
    proposed_actions: [
      {
        ...approved,
        action_type: 'facebook.publish',
        status: 'waiting_approval',
      },
    ],
  }).db;
  const response = await createApi()(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: 'PUBLISHING_DISABLED' },
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('allows denial of a Facebook proposal while publishing is switched off', async () => {
  vi.stubEnv('FACEBOOK_PUBLISHING_ENABLED', 'false');
  mocks.db = memoryDb({
    proposed_actions: [
      {
        ...approved,
        action_type: 'facebook.publish',
        status: 'waiting_approval',
      },
    ],
  }).db;
  mocks.rpc.mockResolvedValue({ ...approved, status: 'denied' });
  const response = await createApi()(request(undefined, 'deny'));
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(mocks.db, 'decide_action', {
    p_action: id,
    p_user: 'owner',
    p_decision: 'deny',
  });
  expect(mocks.execute).not.toHaveBeenCalled();
});

it('allows one approval and execution request when Facebook publishing is enabled', async () => {
  vi.stubEnv('FACEBOOK_PUBLISHING_ENABLED', 'true');
  mocks.db = memoryDb({
    proposed_actions: [
      {
        ...approved,
        action_type: 'facebook.publish',
        status: 'waiting_approval',
      },
    ],
  }).db;
  const response = await createApi()(request());
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(id, 'owner');
});
