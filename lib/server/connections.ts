import { z } from 'zod';
import {
  providers,
  type Provider,
  type ConnectionInfo,
  type ResourceChoice,
  type AdditionalProvider,
} from '../integrations';
import { adminDb, checked, rpc } from './db';
import { decrypt } from './crypto';
import { env } from './config';
import { providerReady, googleAdsClient } from './provider-config';
import { AppError, requireValue, timedFetch } from './errors';
import { googleRefreshFailure } from './provider-http';
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
          'provider,connection_id,external_id,display_name,status,verified_at,last_error_code,last_error_at',
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
      lastErrorCode: row?.last_error_code || null,
      lastErrorAt: row?.last_error_at || null,
      capabilities:
        row?.status === 'connected' && !row?.last_error_code && configured
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
  options: { allowReadOnlyRecheck?: boolean } = {},
) {
  let query = adminDb()
    .from('integration_credentials')
    .select(
      'connection_id,external_id,encrypted_refresh_token,credential_kind,status,last_error_code',
    )
    .eq('workspace_id', workspaceId)
    .eq('provider', provider);
  if (connectionId) query = query.eq('connection_id', connectionId);
  const row = checked(await query.maybeSingle());
  if (row?.last_error_code === 'FACEBOOK_PERMISSIONS_REQUIRED')
    throw new AppError(
      'FACEBOOK_PERMISSIONS_REQUIRED',
      409,
      'Reconnect Facebook and grant the required publishing permissions.',
    );
  if (
    row?.status === 'connected' &&
    row.last_error_code &&
    !(options.allowReadOnlyRecheck === true && connectionId)
  )
    throw new AppError(
      row.last_error_code,
      409,
      'Resolve the saved connection issue in Connections, then check the connection again.',
    );
  requireValue(
    row &&
      ((row.status === 'connected' && !row.last_error_code) ||
        (options.allowReadOnlyRecheck === true &&
          !!connectionId &&
          ['connected', 'reconnect_required'].includes(row.status) &&
          row.last_error_code !== 'FACEBOOK_PERMISSIONS_REQUIRED')) &&
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
  if (!response.ok) throw await googleRefreshFailure(response, 'google_ads');
  return z
    .object({ access_token: z.string().min(1) })
    .parse(await response.json()).access_token;
}
export async function recordConnectionVerification(
  workspaceId: string,
  provider: Provider,
  connectionId: string,
  details: { displayName?: string; metadata?: Record<string, unknown> } = {},
) {
  const update: Record<string, unknown> = {
    status: 'connected',
    verified_at: new Date().toISOString(),
    last_error_code: null,
    last_error_at: null,
  };
  if (details.displayName) update.display_name = details.displayName;
  if (details.metadata) update.metadata = details.metadata;
  checked(
    await adminDb()
      .from('integration_credentials')
      .update(update)
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('connection_id', connectionId),
  );
}

export async function markConnectionReconnectRequired(
  workspaceId: string,
  provider: Provider,
  connectionId: string,
  errorCode: string,
) {
  checked(
    await adminDb()
      .from('integration_credentials')
      .update({
        status: 'reconnect_required',
        last_error_code: errorCode,
        last_error_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('connection_id', connectionId),
  );
}
export async function recordConnectionIssue(
  workspaceId: string,
  provider: Provider,
  connectionId: string,
  errorCode: string,
) {
  checked(
    await adminDb()
      .from('integration_credentials')
      .update({
        verified_at: null,
        last_error_code: errorCode,
        last_error_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('provider', provider)
      .eq('connection_id', connectionId),
  );
}
export async function disconnectIntegration(
  workspaceId: string,
  provider: Provider,
  userId: string,
  connectionId?: string,
) {
  await rpc(adminDb(), 'disconnect_integration', {
    p_workspace: workspaceId,
    p_provider: provider,
    p_user: userId,
    p_connection: connectionId || null,
  });
  if (provider === 'google_calendar') {
    const { invalidateCalendarTokenCache } = await import('./calendar');
    invalidateCalendarTokenCache(workspaceId);
  }
}
export type CandidateSecrets = {
  resources: (ResourceChoice & { token: string })[];
  scopes: string[];
  limited: boolean;
  incomplete?: boolean;
};
