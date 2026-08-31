import { z } from 'zod';
import {
  providers,
  type Provider,
  type ConnectionInfo,
  type ResourceChoice,
  type AdditionalProvider,
} from '../integrations';
import { adminDb, checked } from './db';
import { decrypt } from './crypto';
import { env } from './config';
import { providerReady, googleAdsClient } from './provider-config';
import { requireValue, timedFetch } from './errors';
export const ProviderSchema = z.enum(providers);
export const AdditionalProviderSchema = z.enum(['facebook', 'google_ads']);
export const StoredCredentials = z
  .object({
    token: z.string().min(1),
    resource: z.object({
      id: z.string(),
      name: z.string(),
      currency: z.string().optional(),
      timeZone: z.string().optional(),
      loginCustomerId: z.string().optional(),
    }),
    scopes: z.array(z.string()),
  })
  .strict();
export const credentialContext = (
  workspace: string,
  provider: string,
  connection: string,
) => workspace + ':' + provider + ':' + connection;
export async function connectionList(
  workspaceId: string,
): Promise<ConnectionInfo[]> {
  const rows =
    checked(
      await adminDb()
        .from('integration_credentials')
        .select(
          'provider,connection_id,external_id,display_name,status,verified_at',
        )
        .eq('workspace_id', workspaceId),
    ) || [];
  return providers.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    const configured =
      provider === 'google_calendar'
        ? !!(
            env('GOOGLE_CLIENT_ID') &&
            env('GOOGLE_CLIENT_SECRET') &&
            env('TOKEN_ENCRYPTION_KEY') &&
            env('APP_ORIGIN')
          )
        : providerReady(provider);
    return {
      provider,
      configured,
      connectionId: row?.connection_id || null,
      status: !configured ? 'not_configured' : row?.status || 'not_connected',
      externalId: row?.external_id || null,
      displayName: row?.display_name || null,
      verifiedAt: row?.verified_at || null,
      capabilities:
        row?.status === 'connected' && configured
          ? provider === 'facebook'
            ? env('FACEBOOK_PUBLISHING_ENABLED') === 'true'
              ? ['facebook.publish']
              : []
            : provider === 'google_ads'
              ? ['ads.report']
              : ['calendar.create']
          : [],
    };
  });
}
export async function providerCredentials(
  workspaceId: string,
  provider: AdditionalProvider,
  connectionId?: string,
) {
  let query = adminDb()
    .from('integration_credentials')
    .select(
      'connection_id,external_id,encrypted_refresh_token,credential_kind,status',
    )
    .eq('workspace_id', workspaceId)
    .eq('provider', provider);
  if (connectionId) query = query.eq('connection_id', connectionId);
  const row = checked(await query.maybeSingle());
  requireValue(
    row &&
      row.status === 'connected' &&
      row.credential_kind === 'provider_json_v1',
    'RECONNECT_REQUIRED',
    409,
    'Connect this service again before continuing.',
  );
  const secret = StoredCredentials.parse(
    JSON.parse(
      await decrypt(
        row.encrypted_refresh_token,
        credentialContext(workspaceId, provider, row.connection_id),
      ),
    ),
  );
  requireValue(
    secret.resource.id === row.external_id,
    'CONNECTION_CHANGED',
    409,
  );
  return { ...secret, connectionId: row.connection_id as string };
}
export async function googleAdsAccess(refreshToken: string) {
  const client = googleAdsClient();
  const response = await timedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.id,
      client_secret: client.secret,
    }),
    redirect: 'manual',
  });
  requireValue(
    response.ok,
    'RECONNECT_REQUIRED',
    409,
    'Reconnect Google Ads to restore reporting access.',
  );
  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}
export async function recordConnectionVerification(
  workspaceId: string,
  provider: Provider,
  connectionId: string,
) {
  checked(
    await adminDb()
      .from('integration_credentials')
      .update({ verified_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('connection_id', connectionId),
  );
}
export type CandidateSecrets = {
  resources: (ResourceChoice & { token: string })[];
  scopes: string[];
  limited: boolean;
};
