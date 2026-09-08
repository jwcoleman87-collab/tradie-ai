import { expect, it } from 'vitest';
import type { Action, Snapshot } from '../lib/contracts';
import {
  isDoneAction,
  isRunningAction,
  workspaceActions,
  workspaceActivity,
} from '../lib/workspace-ui';

const now = Date.parse('2026-09-06T01:00:00Z');
const past = '2026-09-06T00:59:59Z';
const present = '2026-09-06T01:00:00Z';
const future = '2026-09-06T01:01:00Z';
const proposal = (id: string, patch: Partial<Action> = {}): Action => ({
  id,
  workspace_id: 'workspace-a',
  conversation_id: 'conversation-a',
  connection_id: 'connection-a',
  agent: 'social',
  action_type: 'facebook.publish',
  summary: id,
  payload: { pageId: '123', message: 'Owner-reviewed post.' },
  status: 'waiting_approval',
  expires_at: future,
  created_at: past,
  error_code: null,
  execution_result: null,
  ...patch,
});
const ids = (actions: Action[]) => actions.map((action) => action.id);

it('keeps filter counts equal to their loaded rows while live execution belongs only to All', () => {
  const actions = [
    proposal('waiting'),
    proposal('approved', { status: 'approved' }),
    proposal('running', { status: 'executing', lease_until: future }),
    proposal('interrupted', { status: 'executing', lease_until: past }),
    proposal('failed', { status: 'failed' }),
    proposal('completed', { status: 'completed' }),
    proposal('denied', { status: 'denied' }),
    proposal('expired', { status: 'expired' }),
    proposal('cancelled', { status: 'cancelled' }),
    proposal('superseded', { status: 'superseded' }),
    proposal('expired-waiting', { expires_at: past }),
  ];
  const groups = workspaceActions(actions, now);
  expect(ids(groups.all)).toEqual(ids(actions));
  expect(ids(groups['needs-you'])).toEqual([
    'waiting',
    'approved',
    'interrupted',
    'failed',
  ]);
  expect(ids(groups.done)).toEqual([
    'completed',
    'denied',
    'expired',
    'cancelled',
    'superseded',
    'expired-waiting',
  ]);
  expect([
    groups['needs-you'].length,
    groups.all.length,
    groups.done.length,
  ]).toEqual([4, 11, 6]);
  expect(
    groups['needs-you'].some((action) => groups.done.includes(action)),
  ).toBe(false);
});

it('moves an unapproved proposal to Done exactly when it expires without rewriting its server status', () => {
  const action = proposal('waiting', { expires_at: present });
  expect(ids(workspaceActions([action], now - 1)['needs-you'])).toEqual([
    'waiting',
  ]);
  expect(ids(workspaceActions([action], now).done)).toEqual(['waiting']);
  expect(workspaceActions([action], now)['needs-you']).toEqual([]);
  expect(action.status).toBe('waiting_approval');
});

it.each(['approved', 'failed', 'executing'] as const)(
  'does not turn already %s work into history merely because its former approval window elapsed',
  (status) => {
    const action = proposal('recoverable', { status, expires_at: past });
    expect(isDoneAction(action, now)).toBe(false);
    expect(ids(workspaceActions([action], now)['needs-you'])).toEqual([
      'recoverable',
    ]);
  },
);

it.each([past, present, null, undefined, 'invalid'])(
  'requires intervention when an execution lease is unavailable or no longer live (%s)',
  (lease_until) => {
    const action = proposal('interrupted', {
      status: 'executing',
      lease_until,
    });
    expect(isRunningAction(action, now)).toBe(false);
    expect(ids(workspaceActions([action], now)['needs-you'])).toEqual([
      'interrupted',
    ]);
  },
);

it('moves a live action into Needs you when its execution lease expires', () => {
  const action = proposal('running', {
    status: 'executing',
    lease_until: present,
  });
  expect(isRunningAction(action, now - 1)).toBe(true);
  expect(workspaceActions([action], now - 1)['needs-you']).toEqual([]);
  expect(isRunningAction(action, now)).toBe(false);
  expect(ids(workspaceActions([action], now)['needs-you'])).toEqual([
    'running',
  ]);
});

it.each([
  { error_code: 'PUBLICATION_UNCERTAIN' },
  { publication_status: 'uncertain' as const },
  { publication_status: 'confirmed' as const },
])(
  'retains Facebook review work even when a future lease accompanies %j',
  (patch) => {
    const action = proposal('review-publication', {
      status: 'executing',
      lease_until: future,
      ...patch,
    });
    expect(isRunningAction(action, now)).toBe(false);
    expect(ids(workspaceActions([action], now)['needs-you'])).toEqual([
      'review-publication',
    ]);
    expect(workspaceActivity([action], [], now).workingAgents.size).toBe(0);
  },
);

it('treats a currently sending Facebook post as active while its lease remains live', () => {
  const action = proposal('sending', {
    status: 'executing',
    lease_until: future,
    publication_status: 'sending',
  });
  expect(isRunningAction(action, now)).toBe(true);
  expect(workspaceActions([action], now)['needs-you']).toEqual([]);
  expect([...workspaceActivity([action], [], now).workingAgents]).toEqual([
    'social',
  ]);
});

it('keeps exhausted retries and manual reconciliation in Needs you without requiring an available retry', () => {
  const actions = [
    proposal('retry-limit', { status: 'failed', attempts: 5 }),
    proposal('calendar-review', {
      action_type: 'calendar.create',
      status: 'failed',
      error_code: 'CALENDAR_RECONCILIATION_REQUIRED',
    }),
    proposal('uncertain-post', {
      status: 'failed',
      publication_status: 'uncertain',
    }),
    proposal('confirmed-post', {
      status: 'failed',
      publication_status: 'confirmed',
    }),
  ];
  expect(ids(workspaceActions(actions, now)['needs-you'])).toEqual(
    ids(actions),
  );
  expect(workspaceActivity(actions, [], now).running).toEqual([]);
});

it.each(['uncertain', 'confirmed'] as const)(
  'keeps a closed Facebook action in Done while preserving its %s publication evidence',
  (publication_status) => {
    const action = proposal('closed', {
      status: 'cancelled',
      publication_status,
      error_code: 'PUBLICATION_UNCERTAIN',
      lease_until: future,
      publication_receipt: { url: 'https://www.facebook.com/123_456' },
    });
    expect(isDoneAction(action, now)).toBe(true);
    expect(workspaceActions([action], now)['needs-you']).toEqual([]);
    expect(workspaceActions([action], now).done).toEqual([action]);
    expect(action.publication_status).toBe(publication_status);
    expect(action.publication_receipt?.url).toBe(
      'https://www.facebook.com/123_456',
    );
    expect(workspaceActivity([action], [], now).running).toEqual([]);
  },
);

const run = (
  id: string,
  status: string,
  agents: Snapshot['runs'][number]['agents'],
): Snapshot['runs'][number] => ({
  id,
  status,
  agents,
  created_at: past,
  finished_at: status === 'completed' ? present : null,
  model: null,
  error_code: status === 'failed' ? 'AI_TIMEOUT' : null,
  provider_trace: [],
});

it('distinguishes current executing agents from contributors to the latest completed reply', () => {
  const actions = [
    proposal('social-active', { status: 'executing', lease_until: future }),
    proposal('social-active-again', {
      status: 'executing',
      lease_until: future,
    }),
    proposal('finance-approved', { agent: 'finance', status: 'approved' }),
    proposal('marketing-interrupted', {
      agent: 'marketing',
      status: 'executing',
      lease_until: past,
    }),
    proposal('website-completed', { agent: 'website', status: 'completed' }),
  ];
  const runs = [
    run('pending', 'working', ['website']),
    run('failed', 'failed', ['finance']),
    run('latest-reply', 'completed', ['maintenance', 'marketing']),
    run('older-reply', 'completed', ['social']),
  ];
  const activity = workspaceActivity(actions, runs, now);
  expect(ids(activity.running)).toEqual([
    'social-active',
    'social-active-again',
  ]);
  expect([...activity.workingAgents]).toEqual(['social']);
  expect([...activity.contributors]).toEqual(['maintenance', 'marketing']);
});

it('does not invent individual agent activity or contributions from a pending or failed run', () => {
  const activity = workspaceActivity(
    [],
    [
      run('pending', 'working', ['website']),
      run('failed', 'failed', ['finance']),
    ],
    now,
  );
  expect(activity.running).toEqual([]);
  expect(activity.workingAgents.size).toBe(0);
  expect(activity.contributors.size).toBe(0);
  expect(workspaceActions([], now)).toEqual({
    'needs-you': [],
    all: [],
    done: [],
  });
});
