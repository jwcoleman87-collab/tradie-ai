import { appOrigin, required } from './config';
import { adminDb, checked, rpc } from './db';
import { encrypt, randomSecret, sha256 } from './crypto';
import { requireValue, timedFetch } from './errors';
import { noStore } from './http';
import { calendarReturnUrl } from './oauth-return';
import { providerCallback } from './provider-callbacks';
import { readPrimaryCalendar } from './calendar';
const scope = 'https://www.googleapis.com/auth/calendar.events';
const cookieName = 'tradie_oauth';
function cookie(value: string, maxAge: number) {
  return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/api/google/callback; Max-Age=${maxAge}${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
export async function startGoogle(workspaceId: string, userId: string) {
  required('TOKEN_ENCRYPTION_KEY');
  required('GOOGLE_CLIENT_SECRET');
  const state = randomSecret(),
    nonce = randomSecret(),
    verifier = randomSecret();
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  const db = adminDb();
  checked(
    await db.from('oauth_states').insert({
      state_hash: await sha256(state),
      cookie_hash: await sha256(nonce),
      workspace_id: workspaceId,
      user_id: userId,
      verifier,
    }),
  );
  const params = new URLSearchParams({
    client_id: required('GOOGLE_CLIENT_ID'),
    redirect_uri: providerCallback('google_calendar'),
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return Response.json(
    { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
    { headers: { ...noStore, 'Set-Cookie': cookie(nonce, 600) } },
  );
}
export async function finishGoogle(request: Request) {
  const url = new URL(request.url),
    state = url.searchParams.get('state'),
    code = url.searchParams.get('code');
  const nonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  requireValue(
    state && nonce,
    'OAUTH_STATE_INVALID',
    403,
    'Google connection expired. Please start again from your workspace.',
  );
  const db = adminDb();
  const stored = await rpc<{
    workspace_id: string;
    user_id: string;
    verifier: string;
    provider: string;
    generation: number;
  }>(db, 'consume_oauth_state', {
    p_state: await sha256(state),
    p_cookie: await sha256(nonce),
  });
  requireValue(
    stored.provider === 'google_calendar',
    'OAUTH_STATE_INVALID',
    403,
  );
  if (url.searchParams.has('error'))
    return new Response(null, {
      status: 303,
      headers: {
        ...noStore,
        Location: calendarReturnUrl(appOrigin(), 'cancelled'),
        'Set-Cookie': cookie('', 0),
      },
    });
  requireValue(code, 'OAUTH_CODE_MISSING');
  const response = await timedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: required('GOOGLE_CLIENT_ID'),
      client_secret: required('GOOGLE_CLIENT_SECRET'),
      redirect_uri: providerCallback('google_calendar'),
      code_verifier: stored.verifier,
    }),
  });
  requireValue(
    response.ok,
    'OAUTH_EXCHANGE_FAILED',
    502,
    'Google did not complete the connection. Please try again.',
  );
  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
  };
  requireValue(
    tokens.refresh_token && tokens.scope?.split(' ').includes(scope),
    'GOOGLE_SCOPE_REQUIRED',
    403,
    'Calendar access was not granted. Please reconnect and allow Calendar access.',
  );
  requireValue(tokens.access_token, 'OAUTH_EXCHANGE_FAILED', 502);
  const calendar = await readPrimaryCalendar(tokens.access_token);
  await rpc(db, 'complete_calendar_connection', {
    p_workspace: stored.workspace_id,
    p_user: stored.user_id,
    p_generation: stored.generation,
    p_connection: crypto.randomUUID(),
    p_ciphertext: await encrypt(tokens.refresh_token, stored.workspace_id),
    p_name: calendar.summary,
    p_scopes: [scope],
    p_metadata: { timeZone: calendar.timeZone || null },
  });
  const { invalidateCalendarTokenCache } = await import('./calendar');
  invalidateCalendarTokenCache(stored.workspace_id);
  return new Response(null, {
    status: 303,
    headers: {
      ...noStore,
      Location: calendarReturnUrl(appOrigin(), 'connected'),
      'Set-Cookie': cookie('', 0),
    },
  });
}
