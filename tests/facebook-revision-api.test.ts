import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApi } from '../lib/server/api';
import { AppError } from '../lib/server/errors';
import { memoryDb } from './fixtures/memory-db';

const mocks = vi.hoisted(() => ({
  db: {} as unknown,
  rpc: vi.fn(),
  membership: vi.fn(),
}));
vi.mock('../lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/db')>()),
  adminDb: () => mocks.db,
  authenticate: async () => ({ db: mocks.db, user: { id: 'owner' } }),
  membership: mocks.membership,
  rpc: mocks.rpc,
}));
vi.mock('../lib/server/onboarding-api', () => ({
  onboardingApi: async () => null,
}));
const id = crypto.randomUUID();
const source = {
  id,
  workspace_id: 'workspace-a',
  action_type: 'facebook.publish',
  payload: {
    pageId: '12345',
    message: 'Original caption',
    imageFileId: null as string | null,
    link: null,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = memoryDb({ proposed_actions: [source] }).db;
  mocks.membership.mockResolvedValue('owner');
  mocks.rpc.mockResolvedValue({
    id: crypto.randomUUID(),
    status: 'waiting_approval',
    replaces_action_id: id,
    payload: { ...source.payload, message: 'Edited caption' },
    execution_token: 'PRIVATE',
    approved_by: 'PRIVATE',
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const request = (body: unknown = { message: 'Edited caption', link: null }) =>
  new Request(`https://example.test/api/actions/${id}/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

it('creates a replacement for review without approving or executing it', async () => {
  const response = await createApi()(request());
  expect(response.status).toBe(200);
  const receipt = await response.text();
  expect(JSON.parse(receipt)).toMatchObject({
    status: 'waiting_approval',
    replaces_action_id: id,
    payload: { pageId: '12345', message: 'Edited caption' },
  });
  expect(receipt).not.toContain('PRIVATE');
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    mocks.db,
    'revise_facebook_action',
    {
      p_action: id,
      p_user: 'owner',
      p_message: 'Edited caption',
      p_link: null,
    },
  );
});

it.each([
  { message: '', link: null },
  { message: 'x'.repeat(5001), link: null },
  { message: 'Edited', link: 'http://example.test' },
  { message: 'Edited', link: 'https://user:secret@example.test' },
  { message: 'Edited', link: null, pageId: '67890' },
  { message: 'Edited', link: null, imageFileId: crypto.randomUUID() },
])('rejects an invalid or expanded edit payload: %j', async (body) => {
  expect((await createApi()(request(body))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('keeps the existing selected image and rejects a link preview beside it', async () => {
  mocks.db = memoryDb({
    proposed_actions: [
      {
        ...source,
        payload: { ...source.payload, imageFileId: crypto.randomUUID() },
      },
    ],
  }).db;
  expect(
    (
      await createApi()(
        request({ message: 'Edited', link: 'https://example.test' }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('requires the workspace owner before editing', async () => {
  mocks.membership.mockRejectedValue(new AppError('OWNER_REQUIRED', 403));
  expect((await createApi()(request())).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('does not convert a private draft into a publishing action', async () => {
  mocks.db = memoryDb({
    proposed_actions: [{ ...source, action_type: 'draft.save' }],
  }).db;
  expect((await createApi()(request())).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('passes a stale-edit rejection through without an execution attempt', async () => {
  mocks.rpc.mockRejectedValue(new AppError('CONFLICT', 409));
  expect((await createApi()(request())).status).toBe(409);
  expect(mocks.rpc).toHaveBeenCalledOnce();
});
