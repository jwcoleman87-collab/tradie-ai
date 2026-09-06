import { Proposal, type Action } from '../contracts';
import { adminDb, checked, rpc } from './db';
import { AppError } from './errors';
import { createCalendarEvent } from './calendar';
import { publishFacebook } from './facebook';
import { ACTION_FIELDS, publicAction } from './action-data';

export async function replaceConnectionAction(
  actionId: string,
  userId: string,
  connectionId: string,
) {
  return publicAction(
    await rpc<Action>(adminDb(), 'replace_connection_action', {
      p_action: actionId,
      p_user: userId,
      p_connection: connectionId,
    }),
  );
}

export async function cancelAction(actionId: string, userId: string) {
  return publicAction(
    await rpc<Action>(adminDb(), 'cancel_action', {
      p_action: actionId,
      p_user: userId,
    }),
  );
}

export async function reviseFacebookAction(
  actionId: string,
  userId: string,
  message: string,
  link: string | null,
) {
  return publicAction(
    await rpc<Action>(adminDb(), 'revise_facebook_action', {
      p_action: actionId,
      p_user: userId,
      p_message: message,
      p_link: link,
    }),
  );
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
  if (!claim.claimed) return publicAction(claim.action);
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
  // Read the durable outcome, including its database completion timestamp.
  // If persistence failed, do not manufacture a success receipt for the UI.
  return checked(
    await db
      .from('proposed_actions')
      .select(ACTION_FIELDS)
      .eq('id', actionId)
      .eq('workspace_id', action.workspace_id)
      .single(),
  ) as Action;
}
