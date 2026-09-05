import { expect, it } from 'vitest';
import {
  actionReceiptUrl,
  actionState,
  canReplaceAction,
} from '../lib/action-state';
import {
  actionContext,
  loadActionData,
  publicAction,
} from '../lib/server/action-data';
import type { Action } from '../lib/contracts';
import { memoryDb } from './fixtures/memory-db';

const now = Date.parse('2026-09-05T01:00:00Z');
export const action: Action = {
  id: crypto.randomUUID(),
  workspace_id: 'workspace-a',
  conversation_id: 'chat-a',
  connection_id: 'connection-a',
  agent: 'social',
  action_type: 'facebook.publish',
  summary: 'Completed driveway job',
  payload: { pageId: '123', message: 'Driveway complete.' },
  status: 'waiting_approval',
  expires_at: '2099-09-06T00:00:00Z',
  error_code: null,
  execution_result: null,
  created_at: '2026-09-01T00:00:00Z',
};
it('distinguishes waiting, unstarted, running, interrupted and completed work', () => {
  expect(actionState(action, now).label).toBe('Waiting on you');
  expect(actionState({ ...action, status: 'approved' }, now)).toMatchObject({
    label: 'Approved, not started',
    retry: 'Resume',
  });
  expect(
    actionState(
      { ...action, status: 'executing', lease_until: '2026-09-05T01:01:00Z' },
      now,
    ),
  ).toMatchObject({ label: 'Sending', retry: null });
  expect(
    actionState(
      { ...action, status: 'executing', lease_until: '2026-09-05T00:59:00Z' },
      now,
    ),
  ).toMatchObject({ label: 'Needs checking', retry: 'Resume' });
  expect(actionState({ ...action, status: 'completed' }, now)).toMatchObject({
    label: 'Sent',
    tone: 'green',
  });
});
it('offers retry after a definite rejection but never calls uncertain publication unsent', () => {
  expect(
    actionState(
      { ...action, status: 'failed', error_code: 'FACEBOOK_REJECTED' },
      now,
    ),
  ).toMatchObject({ label: "Didn't send", tone: 'red', retry: 'Try again' });
  for (const publication_status of ['sending', 'uncertain'] as const)
    expect(
      actionState(
        {
          ...action,
          status: 'failed',
          error_code: 'RECONNECT_REQUIRED',
          publication_status,
        },
        now,
      ),
    ).toMatchObject({ label: 'Check Facebook', retry: null });
  expect(
    actionState(
      { ...action, status: 'failed', error_code: 'PUBLICATION_UNCERTAIN' },
      now,
    ).retry,
  ).toBeNull();
});
it('keeps ambiguous Calendar outcomes and exhausted attempts honest', () => {
  expect(
    actionState(
      {
        ...action,
        action_type: 'calendar.create',
        status: 'failed',
        error_code: 'UPSTREAM_UNAVAILABLE',
      },
      now,
    ).label,
  ).toBe('Needs checking');
  const state = actionState(
    { ...action, status: 'executing', attempts: 5 },
    now,
  );
  expect(state.retry).toBeNull();
  expect(state.detail).toContain('retry limit');
});
it('does not turn an unknown booking into a definite failure after a reconnect error', () => {
  const timedOut = {
    ...action,
    action_type: 'calendar.create' as const,
    status: 'failed' as const,
    error_code: 'UPSTREAM_UNAVAILABLE',
    attempts: 1,
  };
  expect(actionState(timedOut, now).label).toBe('Needs checking');
  const retry = { ...timedOut, error_code: 'RECONNECT_REQUIRED', attempts: 2 };
  expect(actionState(retry, now).label).toBe('Booking not confirmed');
  expect(actionState(retry, now).detail).toContain(
    'No successful booking receipt',
  );
});
it('shows a confirmed Facebook receipt without offering an impossible replacement after connection change', () => {
  const published: Action = {
    ...action,
    status: 'failed',
    error_code: 'CONNECTION_CHANGED',
    publication_status: 'confirmed',
    publication_receipt: { url: 'https://www.facebook.com/123_456' },
    publication_confirmed_at: '2026-09-05T00:01:00Z',
  };
  expect(actionState(published, now)).toMatchObject({
    label: 'Sent, needs review',
    retry: null,
  });
  expect(canReplaceAction(published)).toBe(false);
  expect(actionReceiptUrl(published)).toBe('https://www.facebook.com/123_456');
});
it('links only completed receipts on the correct provider host and strips internal fields', () => {
  const sent = {
    ...action,
    status: 'completed' as const,
    execution_result: { url: 'https://www.facebook.com/123_456' },
  };
  expect(actionReceiptUrl(sent)).toBe('https://www.facebook.com/123_456');
  expect(actionReceiptUrl({ ...sent, status: 'failed' })).toBeNull();
  for (const url of [
    'https://www.facebook.com.attacker.test/123_456',
    'https://password@www.facebook.com/123_456',
    'javascript:alert(1)',
    'https://calendar.google.com/calendar/event',
  ])
    expect(actionReceiptUrl({ ...sent, execution_result: { url } })).toBeNull();
  const safe = publicAction({
    ...action,
    execution_token: 'PRIVATE',
    approved_by: 'PRIVATE',
  } as Action);
  expect(JSON.stringify(safe)).not.toContain('PRIVATE');
});
it('retains confirmed and uncertain publication evidence after an action is closed', async () => {
  const { db } = memoryDb({
    proposed_actions: [
      {
        ...action,
        id: 'confirmed',
        status: 'cancelled',
        error_code: 'PUBLICATION_UNCERTAIN',
      },
      {
        ...action,
        id: 'uncertain',
        status: 'cancelled',
        error_code: 'RECONNECT_REQUIRED',
      },
    ],
    external_publish_attempts: [
      {
        workspace_id: action.workspace_id,
        action_id: 'confirmed',
        status: 'confirmed',
        receipt: { url: 'https://www.facebook.com/123_456' },
        updated_at: '2026-09-05T00:01:00Z',
      },
      {
        workspace_id: action.workspace_id,
        action_id: 'uncertain',
        status: 'uncertain',
      },
    ],
  });
  const result = await loadActionData(
    db,
    db,
    action.workspace_id,
    action.conversation_id,
  );
  const published = actionContext(
    result.actions.find((a) => a.id === 'confirmed')!,
  );
  expect(published).toMatchObject({
    status: 'cancelled',
    displayState: 'Sent, needs review',
    receiptUrl: 'https://www.facebook.com/123_456',
    publicationConfirmedAt: '2026-09-05T00:01:00Z',
  });
  const uncertain = result.actions.find((a) => a.id === 'uncertain')!;
  expect(actionState(uncertain)).toMatchObject({
    label: 'Check Facebook',
    retry: null,
  });
  expect(canReplaceAction(uncertain)).toBe(false);
});
it('keeps old approved work visible despite newer history and expired proposals', async () => {
  const rows = [
    { ...action, status: 'approved' },
    ...Array.from({ length: 110 }, (_, i) => ({
      ...action,
      id: `done-${i}`,
      status: 'completed',
      created_at: '2026-09-04T00:00:00Z',
    })),
    ...Array.from({ length: 110 }, (_, i) => ({
      ...action,
      id: `expired-${i}`,
      created_at: '2026-08-01T00:00:00Z',
      expires_at: '2026-08-02T00:00:00Z',
    })),
    {
      ...action,
      id: 'other-tenant',
      workspace_id: 'workspace-b',
      status: 'approved',
    },
    {
      ...action,
      id: 'other-chat',
      conversation_id: 'chat-b',
      status: 'approved',
    },
  ];
  const { db } = memoryDb({
    proposed_actions: rows,
    external_publish_attempts: [
      {
        workspace_id: action.workspace_id,
        action_id: action.id,
        status: 'uncertain',
      },
    ],
  });
  const result = await loadActionData(db, db, 'workspace-a', 'chat-a');
  expect(result.actions[0]).toMatchObject({
    id: action.id,
    status: 'approved',
    publication_status: 'uncertain',
  });
  expect(result.coverage.outstandingTotal).toBe(1);
  expect(result.coverage.historyTotal).toBe(220);
  expect(result.actions.some((a) => a.id.startsWith('other-'))).toBe(false);
  expect(actionContext(result.actions[0]).displayState).toBe('Check Facebook');
});
