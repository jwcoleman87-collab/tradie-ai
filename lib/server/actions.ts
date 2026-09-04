import { Proposal, type Action } from '../contracts';
import { adminDb, rpc } from './db';
import { AppError } from './errors';
import { createCalendarEvent } from './calendar';
import { publishFacebook } from './facebook';

export async function replaceConnectionAction(
  actionId: string,
  userId: string,
  connectionId: string,
) {
  return rpc<Action>(adminDb(), 'replace_connection_action', {
    p_action: actionId,
    p_user: userId,
    p_connection: connectionId,
  });
}

export async function cancelAction(actionId: string, userId: string) {
  return rpc<Action>(adminDb(), 'cancel_action', {
    p_action: actionId,
    p_user: userId,
  });
}

export async function executeAction(
  actionId: string,
  userId: string,
  executeCalendar = createCalendarEvent,
) {
  const db = adminDb();
  const claim = await rpc<{ claimed: boolean; action: Action; token: string }>(
    db,
    'claim_action',
    { p_action: actionId, p_user: userId },
  );
  if (!claim.claimed) return claim.action;
  const action = claim.action;
  let result: unknown = null;
  let errorCode: string | null = null;
  try {
    const p = Proposal.parse({
      type: action.action_type,
      summary: action.summary,
      agent: action.agent,
      payload: action.payload,
    });
    if (p.type === 'calendar.create')
      result = await executeCalendar(
        action.workspace_id,
        action.id,
        p.payload,
        action.connection_id!,
      );
    else if (p.type === 'facebook.publish')
      result = await publishFacebook(
        action.workspace_id,
        action.conversation_id,
        action.id,
        p.payload,
        action.connection_id!,
        claim.token,
      );
    else result = { recordId: action.id, operation: p.type, published: false };
  } catch (error) {
    errorCode = error instanceof AppError ? error.code : 'EXECUTION_FAILED';
  }
  await rpc(db, 'finish_action', {
    p_action: actionId,
    p_token: claim.token,
    p_result: result,
    p_error: errorCode,
  });
  return {
    ...action,
    status: errorCode ? 'failed' : 'completed',
    execution_result: result,
    error_code: errorCode,
  };
}
