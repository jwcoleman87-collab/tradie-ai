import { beforeEach, expect, it, vi } from 'vitest';
import { executeAction } from '../lib/server/actions';
import { publishFacebook } from '../lib/server/facebook';
import { memoryDb } from './fixtures/memory-db';

const mocks = vi.hoisted(() => ({ db: {} as unknown, rpc: vi.fn() }));
vi.mock('../lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/db')>()),
  adminDb: () => mocks.db,
  rpc: mocks.rpc,
}));
const id = crypto.randomUUID();
const row = {
  id,
  workspace_id: 'a',
  conversation_id: 'c',
  status: 'completed',
  action_type: 'record.create',
  agent: 'maintenance',
  summary: 'Machine hours',
  payload: { kind: 'asset', title: 'Excavator', body: '312 operating hours' },
  approved_at: '2026-09-05T01:00:00Z',
  executed_at: '2026-09-05T01:00:03Z',
  error_code: null,
  execution_result: { recordId: id, published: false },
  execution_token: 'PRIVATE',
  approved_by: 'PRIVATE',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = memoryDb({ proposed_actions: [row] }).db;
  mocks.rpc.mockImplementation(async (_db, name) =>
    name === 'claim_action'
      ? {
          claimed: true,
          token: 'lease',
          action: { ...row, status: 'executing', executed_at: null },
        }
      : null,
  );
});
it('returns the persisted completion timestamp and strips private claim metadata', async () => {
  const result = await executeAction(id, 'owner');
  expect(result.executed_at).toBe(row.executed_at);
  expect(result.status).toBe('completed');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(mocks.rpc).toHaveBeenCalledWith(
    mocks.db,
    'finish_action',
    expect.objectContaining({ p_action: id, p_token: 'lease', p_error: null }),
  );
});
it('does not fabricate completion when finish_action cannot persist it', async () => {
  mocks.rpc.mockImplementation(async (_db, name) => {
    if (name === 'claim_action')
      return { claimed: true, token: 'lease', action: row };
    throw new Error('persistence failed');
  });
  await expect(executeAction(id, 'owner')).rejects.toThrow(
    'persistence failed',
  );
});
it('strips private metadata when an execution claim is not acquired', async () => {
  mocks.rpc.mockResolvedValue({ claimed: false, action: row });
  const result = await executeAction(id, 'owner');
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
for (const status of ['sending', 'uncertain'])
  it(`preserves a Facebook ${status} outcome before any connection preflight`, async () => {
    mocks.db = memoryDb({
      external_publish_attempts: [{ workspace_id: 'a', action_id: id, status }],
    }).db;
    await expect(
      publishFacebook('a', 'c', id, {}, 'old-connection', 'lease'),
    ).rejects.toMatchObject({ code: 'PUBLICATION_UNCERTAIN' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
it('recovers a confirmed Facebook receipt without posting again', async () => {
  const receipt = {
    postId: '123_456',
    url: 'https://www.facebook.com/123_456',
    published: true,
  };
  mocks.db = memoryDb({
    external_publish_attempts: [
      { workspace_id: 'a', action_id: id, status: 'confirmed', receipt },
    ],
  }).db;
  await expect(
    publishFacebook('a', 'c', id, {}, 'old-connection', 'lease'),
  ).resolves.toEqual(receipt);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
