import { z } from 'zod';
import type {
  AdditionalProvider,
  PendingConnection,
  ResourceChoice,
} from '../integrations';
import { appOrigin, required } from './config';
import { adminDb, checked, rpc } from './db';
import { randomSecret, sha256, encrypt, decrypt } from './crypto';
import { requireValue, timedFetch } from './errors';
import { noStore } from './http';
import { providerReturnUrl } from './oauth-return';
import {
  adsScope,
  facebookScopes,
  googleAdsClient,
  graphVersion,
  providerReady,
} from './provider-config';
import { ExternalId, graphRead } from './provider-http';
import { credentialContext, type CandidateSecrets } from './connections';
import { discoverAdsAccounts, readAdsAccount } from './google-ads';
const callback = (p: AdditionalProvider) =>
  appOrigin() + '/api/integrations/' + p + '/callback';
const cookieName = (p: AdditionalProvider) => 'tradie_oauth_' + p;
function cookie(p: AdditionalProvider, value: string, age: number) {
  return (
    cookieName(p) +
    '=' +
    value +
    '; HttpOnly; SameSite=Lax; Path=/api/integrations/' +
    p +
    '/callback; Max-Age=' +
    age +
    (appOrigin().startsWith('https:') ? '; Secure' : '')
  );
}
export async function startProvider(
  provider: AdditionalProvider,
  workspaceId: string,
  userId: string,
) {
  requireValue(
    providerReady(provider),
    'SETUP_REQUIRED',
    503,
    'This service needs its private application credentials configured first.',
  );
  const state = randomSecret(),
    nonce = randomSecret(),
    verifier = randomSecret();
  const challenge = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  ).toString('base64url');
  const params = new URLSearchParams({
    redirect_uri: callback(provider),
    response_type: 'code',
    state,
  });
  let base: string;
  if (provider === 'facebook') {
    base = 'https://www.facebook.com/' + graphVersion() + '/dialog/oauth';
    params.set('client_id', required('META_APP_ID'));
    params.set('config_id', required('META_LOGIN_CONFIG_ID'));
    params.set('override_default_response_type', 'true');
  } else {
    base = 'https://accounts.google.com/o/oauth2/v2/auth';
    params.set('client_id', googleAdsClient().id);
    params.set('scope', adsScope);
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', 'S256');
  }
  checked(
    await adminDb()
      .from('oauth_states')
      .insert({
        state_hash: await sha256(state),
        cookie_hash: await sha256(nonce),
        workspace_id: workspaceId,
        user_id: userId,
        verifier,
        provider,
      }),
  );
  return Response.json(
    { url: base + '?' + params },
    { headers: { ...noStore, 'Set-Cookie': cookie(provider, nonce, 600) } },
  );
}
async function facebookCandidate(code: string): Promise<CandidateSecrets> {
  const tokenEndpoint =
    'https://graph.facebook.com/' + graphVersion() + '/oauth/access_token';
  // Meta's server-side exchange uses query parameters. Never log these URLs.
  const first = await timedFetch(
    tokenEndpoint +
      '?' +
      new URLSearchParams({
        client_id: required('META_APP_ID'),
        client_secret: required('META_APP_SECRET'),
        redirect_uri: callback('facebook'),
        code,
      }),
    { redirect: 'manual' },
  );
  requireValue(first.ok, 'OAUTH_EXCHANGE_FAILED', 409);
  const short = z
    .object({ access_token: z.string().min(1) })
    .parse(await first.json());
  const exchange = await timedFetch(
    tokenEndpoint +
      '?' +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: required('META_APP_ID'),
        client_secret: required('META_APP_SECRET'),
        fb_exchange_token: short.access_token,
      }),
    { redirect: 'manual' },
  );
  requireValue(exchange.ok, 'OAUTH_EXCHANGE_FAILED', 409);
  const { access_token: token } = z
    .object({ access_token: z.string().min(1) })
    .parse(await exchange.json());
  const grants = z
    .object({
      data: z.array(z.object({ permission: z.string(), status: z.string() })),
    })
    .parse(await graphRead('me/permissions', token));
  const scopes = grants.data
    .filter((x) => x.status === 'granted')
    .map((x) => x.permission);
  requireValue(
    facebookScopes.every((s) => scopes.includes(s)),
    'FACEBOOK_PERMISSIONS_REQUIRED',
    409,
    'Allow Page listing, Page reading and publishing, then reconnect.',
  );
  const resources: CandidateSecrets['resources'] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = z
      .object({
        data: z.array(
          z.object({
            id: ExternalId,
            name: z.string(),
            access_token: z.string().optional(),
            tasks: z.array(z.string()).default([]),
          }),
        ),
        paging: z
          .object({
            next: z.string().optional(),
            cursors: z.object({ after: z.string().optional() }).optional(),
          })
          .optional(),
      })
      .parse(
        await graphRead('me/accounts', token, {
          fields: 'id,name,access_token,tasks',
          limit: '100',
          ...(after ? { after } : {}),
        }),
      );
    for (const resource of result.data)
      if (
        resource.access_token &&
        resource.tasks.some((t) => ['CREATE_CONTENT', 'MANAGE'].includes(t))
      )
        resources.push({
          id: resource.id,
          name: resource.name,
          token: resource.access_token,
        });
    after = result.paging?.next ? result.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return { resources, scopes, limited: !!after };
}
export async function finishProvider(
  provider: AdditionalProvider,
  request: Request,
) {
  const url = new URL(request.url),
    state = url.searchParams.get('state');
  const nonce = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName(provider) + '='))
    ?.slice(cookieName(provider).length + 1);
  requireValue(
    state && nonce,
    'OAUTH_STATE_INVALID',
    403,
    'This connection attempt expired. Start again from your workspace.',
  );
  const stored = await rpc<{
    workspace_id: string;
    user_id: string;
    verifier: string;
    provider: string;
  }>(adminDb(), 'consume_oauth_state', {
    p_state: await sha256(state),
    p_cookie: await sha256(nonce),
  });
  requireValue(stored.provider === provider, 'OAUTH_STATE_INVALID', 403);
  const redirect = (status: 'cancelled' | 'choose', candidate?: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...noStore,
        'Set-Cookie': cookie(provider, '', 0),
        Location: providerReturnUrl(appOrigin(), provider, status, candidate),
      },
    });
  if (url.searchParams.has('error')) return redirect('cancelled');
  const code = url.searchParams.get('code');
  requireValue(code, 'OAUTH_CODE_MISSING');
  let secrets: CandidateSecrets;
  if (provider === 'facebook') secrets = await facebookCandidate(code);
  else {
    const client = googleAdsClient();
    const response = await timedFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: callback(provider),
        code_verifier: stored.verifier,
      }),
      redirect: 'manual',
    });
    requireValue(response.ok, 'OAUTH_EXCHANGE_FAILED', 409);
    const tokens = z
      .object({
        access_token: z.string(),
        refresh_token: z.string().min(1),
        scope: z.string(),
      })
      .parse(await response.json());
    requireValue(
      tokens.scope.split(' ').includes(adsScope),
      'GOOGLE_ADS_SCOPE_REQUIRED',
      409,
    );
    const discovered = await discoverAdsAccounts(tokens.access_token);
    secrets = {
      ...discovered,
      resources: discovered.resources.map((r) => ({
        ...r,
        token: tokens.refresh_token,
      })),
      scopes: [adsScope],
    };
  }
  requireValue(
    secrets.resources.length,
    'NO_ELIGIBLE_RESOURCES',
    409,
    'No eligible Page or advertiser account was found. Check access in the provider account.',
  );
  const id = crypto.randomUUID();
  checked(
    await adminDb()
      .from('integration_candidates')
      .insert({
        id,
        workspace_id: stored.workspace_id,
        user_id: stored.user_id,
        provider,
        ciphertext: await encrypt(
          JSON.stringify(secrets),
          credentialContext(stored.workspace_id, provider, id),
        ),
      }),
  );
  return redirect('choose', id);
}
const Choice = z.object({
  id: z.string(),
  name: z.string(),
  token: z.string(),
  currency: z.string().optional(),
  timeZone: z.string().optional(),
  loginCustomerId: z.string().optional(),
});
async function decodeCandidate(row: {
  ciphertext: string;
  workspace_id: string;
  provider: string;
  id: string;
}) {
  return z
    .object({
      resources: z.array(Choice),
      scopes: z.array(z.string()),
      limited: z.boolean(),
    })
    .parse(
      JSON.parse(
        await decrypt(
          row.ciphertext,
          credentialContext(row.workspace_id, row.provider, row.id),
        ),
      ),
    );
}
export async function pendingConnections(
  workspaceId: string,
  userId: string,
): Promise<PendingConnection[]> {
  const rows =
    checked(
      await adminDb()
        .from('integration_candidates')
        .select('id,workspace_id,provider,ciphertext,expires_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5),
    ) || [];
  return Promise.all(
    rows.map(async (row) => {
      const decoded = await decodeCandidate(row);
      return {
        id: row.id,
        provider: row.provider,
        expiresAt: row.expires_at,
        limited: decoded.limited,
        resources: decoded.resources.map(
          ({ token: _, ...resource }) => resource,
        ),
      };
    }),
  );
}
export async function selectProviderResource(
  workspaceId: string,
  userId: string,
  candidateId: string,
  resourceId: string,
) {
  const row = checked(
    await adminDb()
      .from('integration_candidates')
      .select('*')
      .eq('id', candidateId)
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
  );
  requireValue(
    row,
    'CONNECTION_EXPIRED',
    409,
    'The selection expired. Connect again.',
  );
  const secrets = await decodeCandidate(row),
    chosen = secrets.resources.find((r) => r.id === resourceId);
  requireValue(chosen, 'RESOURCE_FORBIDDEN', 403);
  let resource: ResourceChoice;
  if (row.provider === 'facebook') {
    const verified = z.object({ id: ExternalId, name: z.string() }).parse(
      await graphRead(ExternalId.parse(chosen.id), chosen.token, {
        fields: 'id,name',
      }),
    );
    requireValue(verified.id === chosen.id, 'RESOURCE_FORBIDDEN', 403);
    resource = verified;
  } else {
    const { googleAdsAccess } = await import('./connections');
    resource = await readAdsAccount(
      await googleAdsAccess(chosen.token),
      chosen.id,
      chosen.loginCustomerId,
    );
  }
  const connectionId = crypto.randomUUID();
  const ciphertext = await encrypt(
    JSON.stringify({ token: chosen.token, resource, scopes: secrets.scopes }),
    credentialContext(workspaceId, row.provider, connectionId),
  );
  await rpc(adminDb(), 'complete_provider_connection', {
    p_candidate: candidateId,
    p_user: userId,
    p_connection: connectionId,
    p_ciphertext: ciphertext,
    p_external: resource.id,
    p_name: resource.name,
    p_scopes: secrets.scopes,
    p_metadata: {
      currency: resource.currency || null,
      timeZone: resource.timeZone || null,
      loginCustomerId: resource.loginCustomerId || null,
    },
  });
}
