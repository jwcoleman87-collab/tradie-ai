import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action } from '../contracts';
import { checked } from './db';
import { actionReceiptUrl, actionState } from '../action-state';

// Never return execution tokens, approving actor IDs or internal lease tokens.
export const ACTION_FIELDS =
  'id,workspace_id,conversation_id,connection_id,agent,action_type,summary,payload,status,expires_at,error_code,execution_result,created_at,approved_at,executed_at,lease_until,attempts,replaces_action_id,superseded_by';
export const OUTSTANDING_STATES = [
  'waiting_approval',
  'approved',
  'executing',
  'failed',
];
const HISTORY_STATES = [
  'completed',
  'denied',
  'expired',
  'superseded',
  'cancelled',
];
export function publicAction(action: Action): Action {
  return Object.fromEntries(
    ACTION_FIELDS.split(',').map((key) => [key, action[key as keyof Action]]),
  ) as Action;
}

export async function loadActionData(
  db: SupabaseClient,
  admin: SupabaseClient,
  workspaceId: string,
  conversationId?: string,
  signal?: AbortSignal,
) {
  const now = new Date().toISOString();
  const query = (states: string[], ascending: boolean, limit: number) => {
    let result = db
      .from('proposed_actions')
      .select(ACTION_FIELDS, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .limit(limit);
    if (states === HISTORY_STATES)
      result = result.order('executed_at', {
        ascending: false,
        nullsFirst: false,
      });
    result = result.order('created_at', { ascending });
    result =
      states === HISTORY_STATES
        ? result.or(
            `status.in.(${HISTORY_STATES.join(',')}),and(status.eq.waiting_approval,expires_at.lte.${now})`,
          )
        : result.in('status', states);
    if (states.length === 1 && states[0] === 'waiting_approval')
      result = result.gt('expires_at', now);
    if (conversationId) result = result.eq('conversation_id', conversationId);
    if (signal) result = result.abortSignal(signal);
    return result;
  };
  // Outstanding work gets its own budget, oldest first. New history cannot
  // push an approved-but-unrun action out of the returned list.
  const [outstanding, waiting, history] = await Promise.all([
    query(['approved', 'executing', 'failed'], true, conversationId ? 30 : 100),
    query(['waiting_approval'], true, conversationId ? 20 : 100),
    query(HISTORY_STATES, false, conversationId ? 20 : 100),
  ]);
  const active = [
    ...(checked(outstanding) || []),
    ...(checked(waiting) || []),
  ] as unknown as Action[];
  const recent = (checked(history) || []) as unknown as Action[];
  const actions = [...active, ...recent];
  const facebookIds = actions
    .filter((a) => a.action_type === 'facebook.publish')
    .map((a) => a.id);
  let publicationQuery = admin
    .from('external_publish_attempts')
    .select('action_id,status,receipt,updated_at')
    .eq('workspace_id', workspaceId)
    .in('action_id', facebookIds);
  if (signal) publicationQuery = publicationQuery.abortSignal(signal);
  const publishStates = facebookIds.length
    ? checked(await publicationQuery) || []
    : [];
  return {
    actions: actions.map((action) => {
      const publication = publishStates.find(
        (attempt) => attempt.action_id === action.id,
      );
      return {
        ...action,
        publication_status: publication?.status || null,
        publication_receipt:
          publication?.status === 'confirmed' &&
          typeof publication.receipt?.url === 'string'
            ? { url: publication.receipt.url }
            : null,
        publication_confirmed_at:
          publication?.status === 'confirmed'
            ? publication.updated_at || null
            : null,
      };
    }) as Action[],
    coverage: {
      outstandingReturned: active.length,
      outstandingTotal:
        outstanding.count !== null &&
        waiting.count !== null &&
        outstanding.count !== undefined &&
        waiting.count !== undefined
          ? outstanding.count + waiting.count
          : null,
      historyReturned: recent.length,
      historyTotal: history.count ?? null,
    },
  };
}

export function actionContext(action: Action) {
  const state = actionState(action);
  return {
    id: action.id,
    agent: action.agent,
    type: action.action_type,
    summary: action.summary,
    status: action.status,
    displayState: state.label,
    outcome: state.detail,
    approvedAt: action.approved_at || null,
    completedAt: action.executed_at || null,
    errorCode: action.error_code,
    publicationStatus: action.publication_status || null,
    publicationConfirmedAt: action.publication_confirmed_at || null,
    receiptUrl: actionReceiptUrl(action),
    // Payload text remains untrusted customer/model data, not instructions.
    payload: JSON.stringify(action.payload).slice(0, 2500),
    payloadShortened: JSON.stringify(action.payload).length > 2500,
  };
}
