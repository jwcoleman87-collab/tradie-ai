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
      WORKSPACE_LIMIT: 429,
      WORKSPACE_ACTIVE_LIMIT: 429,
      WORKSPACE_TOTAL_LIMIT: 429,
      WORKSPACE_DAILY_LIMIT: 429,
      CHAT_BURST_LIMIT: 429,
      CHAT_DAILY_LIMIT: 429,
      CHAT_CONCURRENCY_LIMIT: 429,
      ONBOARDING_BURST_LIMIT: 429,
      ONBOARDING_DAILY_LIMIT: 429,
      QUOTA_CONFIG_INVALID: 503,
      ONBOARDING_REQUEST_MISMATCH: 409,
      ONBOARDING_REVIEW_REQUIRED: 409,
      AI_CONSENT_REQUIRED: 403,
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
    const quotaMessages: Record<string, string> = {
      WORKSPACE_ACTIVE_LIMIT:
        'This account has reached its active workspace limit. Archive a workspace before creating or restoring another.',
      WORKSPACE_TOTAL_LIMIT:
        'This account has reached its total workspace limit, including archived workspaces. Contact support to review capacity.',
      WORKSPACE_DAILY_LIMIT:
        'This account has reached today’s workspace creation limit. Try again after midnight UTC.',
      CHAT_BURST_LIMIT:
        'This account is sending Chat requests too quickly. Wait until the next minute before trying again.',
      CHAT_DAILY_LIMIT:
        'This account has reached today’s Chat request limit. Try again after midnight UTC.',
      CHAT_CONCURRENCY_LIMIT:
        'This account already has the maximum number of Chat requests running. Wait for current work to finish before trying again.',
      ONBOARDING_BURST_LIMIT:
        'This account is sending setup answers too quickly. Wait until the next minute before trying again.',
      ONBOARDING_DAILY_LIMIT:
        'This account has reached today’s setup request limit. Try again after midnight UTC.',
      QUOTA_CONFIG_INVALID:
        'Account request limits need to be configured before new work can be accepted. Contact your administrator.',
      ONBOARDING_REQUEST_MISMATCH:
        'This request ID belongs to a different setup answer.',
      ONBOARDING_REVIEW_REQUIRED:
        'This setup conversation is full. Review the profile before continuing.',
      AI_CONSENT_REQUIRED:
        'Allow Chat to process your setup answers before continuing.',
    };
    let retryAfterSeconds: number | undefined;
    try {
      const value = JSON.parse(error.details || '{}').retryAfterSeconds;
      if (
        [
          'CHAT_BURST_LIMIT',
          'CHAT_DAILY_LIMIT',
          'ONBOARDING_BURST_LIMIT',
          'ONBOARDING_DAILY_LIMIT',
          'WORKSPACE_DAILY_LIMIT',
        ].includes(code || '') &&
        Number.isInteger(value) &&
        value > 0 &&
        value <= 86400
      )
        retryAfterSeconds = value;
    } catch {
      /* An upstream detail string is not trusted as application data. */
    }
    throw new AppError(
      code || 'DATABASE_ERROR',
      code ? statuses[code] || 400 : 503,
      quotaMessages[code || ''] ||
        (code === 'PUBLICATION_UNCERTAIN'
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
                    : code === 'WORKSPACE_LIMIT'
                      ? 'This account has reached its active workspace limit. Archive a workspace before creating or restoring another.'
                      : code === 'RATE_LIMITED'
                        ? 'Please wait a minute before trying again.'
                        : code === 'BUSY'
                          ? 'Your team is still working on the previous request.'
                          : 'The change was not applied. Refresh the workspace and try again.'),
      retryAfterSeconds,
    );
  }
  return data as T;
}
