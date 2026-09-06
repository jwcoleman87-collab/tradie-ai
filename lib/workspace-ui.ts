import type { Action, AgentName, Snapshot } from './contracts';

export type ActionFilter = 'needs-you' | 'all' | 'done';
export function isDoneAction(action: Action, now = Date.now()) {
  return (
    ['completed', 'denied', 'expired', 'cancelled', 'superseded'].includes(
      action.status,
    ) ||
    (action.status === 'waiting_approval' &&
      Date.parse(action.expires_at) <= now)
  );
}
export function isRunningAction(action: Action, now = Date.now()) {
  return (
    action.status === 'executing' &&
    Date.parse(action.lease_until || '') > now &&
    action.error_code !== 'PUBLICATION_UNCERTAIN' &&
    !['uncertain', 'confirmed'].includes(action.publication_status || '')
  );
}
export function workspaceActions(actions: Action[], now = Date.now()) {
  const done = actions.filter((action) => isDoneAction(action, now));
  const needsYou = actions.filter(
    (action) => !isDoneAction(action, now) && !isRunningAction(action, now),
  );
  return { 'needs-you': needsYou, all: actions, done };
}
export function workspaceActivity(
  actions: Action[],
  runs: Snapshot['runs'],
  now = Date.now(),
) {
  const running = actions.filter((action) => isRunningAction(action, now));
  return {
    running,
    workingAgents: new Set<AgentName>(running.map((action) => action.agent)),
    contributors: new Set<AgentName>(
      runs.find((run) => run.status === 'completed')?.agents || [],
    ),
  };
}
