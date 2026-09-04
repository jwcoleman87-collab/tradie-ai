import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { required } from './config';
import { AppError, requireValue } from './errors';

export function adminDb() {
  return createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function authenticate(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer (.+)$/i)?.[1];
  requireValue(
    token,
    'AUTH_REQUIRED',
    401,
    'Please sign in to your workspace.',
  );
  const db = createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_ANON_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  requireValue(
    !error && data.user,
    'INVALID_SESSION',
    401,
    'Your session has expired. Please sign in again.',
  );
  return { db, user: data.user };
}
export async function membership(
  db: SupabaseClient,
  userId: string,
  workspaceId: string,
  owner = false,
) {
  const { data, error } = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  requireValue(
    !error && data,
    'WORKSPACE_FORBIDDEN',
    403,
    'This workspace is not available to your account.',
  );
  requireValue(
    !owner || data.role === 'owner',
    'OWNER_REQUIRED',
    403,
    'Only the workspace owner can approve this change.',
  );
  return data.role as string;
}
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error)
    throw new AppError(
      'DATABASE_ERROR',
      503,
      'Your change could not be saved. Please try again.',
    );
  return result.data;
}
export async function rpc<T = unknown>(
  db: SupabaseClient,
  name: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, params);
  if (error) {
    const code = error.message.match(/TAI:([A-Z_]+)/)?.[1];
    const statuses: Record<string, number> = {
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      RATE_LIMITED: 429,
      CONFLICT: 409,
      EXPIRED: 409,
      BUSY: 409,
      INVALID_INPUT: 400,
      CONSENT_REQUIRED: 403,
      CONNECTION_CHANGED: 409,
      PUBLICATION_UNCERTAIN: 409,
      OUTCOME_REVIEW_REQUIRED: 409,
      CALENDAR_DATE_PASSED: 409,
      RETRY_LIMIT: 409,
      ACTIVE_WORK_REMAINS: 409,
      WORKSPACE_ARCHIVED: 409,
      CONVERSATION_ARCHIVED: 409,
    };
    throw new AppError(
      code || 'DATABASE_ERROR',
      code ? statuses[code] || 400 : 503,
      code === 'PUBLICATION_UNCERTAIN'
        ? 'Facebook may already have published this post. Check the Page; automatic reposting is blocked.'
        : code === 'OUTCOME_REVIEW_REQUIRED'
          ? 'Check the original calendar event outcome before preparing a replacement.'
          : code === 'CALENDAR_DATE_PASSED'
            ? 'The original booking time has passed. Ask Chat to prepare a new booking with a future date.'
            : code === 'ACTIVE_WORK_REMAINS'
              ? 'Finish or deny work that still needs attention before archiving.'
              : code === 'WORKSPACE_ARCHIVED'
                ? 'Restore this workspace before adding new work.'
                : code === 'CONVERSATION_ARCHIVED'
                  ? 'Restore this conversation before adding new messages.'
                  : code === 'RATE_LIMITED'
                    ? 'Please wait a minute before trying again.'
                    : code === 'BUSY'
                      ? 'Your team is still working on the previous request.'
                      : 'The change was not applied. Refresh the workspace and try again.',
    );
  }
  return data as T;
}
