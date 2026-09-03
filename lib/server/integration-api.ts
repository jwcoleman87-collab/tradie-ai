import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Uuid } from '../contracts';
import { body, json } from './http';
import { adminDb, checked, membership, rpc } from './db';
import {
  AdditionalProviderSchema,
  ProviderSchema,
  connectionList,
} from './connections';
import {
  startProvider,
  pendingConnections,
  selectProviderResource,
} from './provider-oauth';
import { googleAdsReport } from './google-ads';
import { verifyProviderConnection } from './connection-health';
import { AppError, requireValue } from './errors';
export async function integrationApi(
  request: Request,
  path: string,
  db: SupabaseClient,
  userId: string,
): Promise<Response | null> {
  if (!path.startsWith('integrations')) return null;
  const url = new URL(request.url),
    method = request.method;
  if (path === 'integrations' && method === 'GET') {
    const workspaceId = Uuid.parse(url.searchParams.get('workspaceId'));
    const role = await membership(db, userId, workspaceId);
    return json({
      connections: await connectionList(workspaceId),
      pending:
        role === 'owner' ? await pendingConnections(workspaceId, userId) : [],
    });
  }
  const start = path.match(/^integrations\/(facebook|google_ads)\/start$/);
  if (start && method === 'POST') {
    const { workspaceId } = z
      .object({ workspaceId: Uuid })
      .strict()
      .parse(await body(request));
    await membership(db, userId, workspaceId, true);
    await rpc(adminDb(), 'consume_rate', {
      p_workspace: workspaceId,
      p_user: userId,
      p_operation: 'oauth',
      p_limit: 5,
    });
    return startProvider(
      AdditionalProviderSchema.parse(start[1]),
      workspaceId,
      userId,
    );
  }
  if (path === 'integrations/select' && method === 'POST') {
    const input = z
      .object({
        workspaceId: Uuid,
        candidateId: Uuid,
        resourceId: z.string().min(1).max(120),
      })
      .strict()
      .parse(await body(request));
    await membership(db, userId, input.workspaceId, true);
    await selectProviderResource(
      input.workspaceId,
      userId,
      input.candidateId,
      input.resourceId,
    );
    return json({ ok: true });
  }
  if (path === 'integrations/check' && method === 'POST') {
    const input = z
      .object({
        workspaceId: Uuid,
        provider: ProviderSchema,
        connectionId: Uuid,
      })
      .strict()
      .parse(await body(request));
    await membership(db, userId, input.workspaceId, true);
    await rpc(adminDb(), 'consume_rate', {
      p_workspace: input.workspaceId,
      p_user: userId,
      p_operation: 'connection.check',
      p_limit: 15,
    });
    try {
      await verifyProviderConnection(
        input.workspaceId,
        input.provider,
        input.connectionId,
      );
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'RECONNECT_REQUIRED'))
        throw error;
    }
    const connection = (await connectionList(input.workspaceId)).find(
      (item) => item.provider === input.provider,
    );
    requireValue(connection, 'NOT_FOUND', 404);
    return json({ connection });
  }
  if (path === 'integrations/disconnect' && method === 'POST') {
    const input = z
      .object({
        workspaceId: Uuid,
        provider: ProviderSchema,
        connectionId: Uuid,
      })
      .strict()
      .parse(await body(request));
    await membership(db, userId, input.workspaceId, true);
    checked(
      await adminDb()
        .from('integration_credentials')
        .delete()
        .eq('workspace_id', input.workspaceId)
        .eq('provider', input.provider)
        .eq('connection_id', input.connectionId),
    );
    checked(
      await adminDb()
        .from('integration_candidates')
        .delete()
        .eq('workspace_id', input.workspaceId)
        .eq('provider', input.provider),
    );
    checked(
      await adminDb()
        .from('oauth_states')
        .delete()
        .eq('workspace_id', input.workspaceId)
        .eq('provider', input.provider),
    );
    return json({ ok: true });
  }
  if (path === 'integrations/google_ads/report' && method === 'GET') {
    const workspaceId = Uuid.parse(url.searchParams.get('workspaceId'));
    await membership(db, userId, workspaceId);
    await rpc(adminDb(), 'consume_rate', {
      p_workspace: workspaceId,
      p_user: userId,
      p_operation: 'ads.report',
      p_limit: 5,
    });
    return json(await googleAdsReport(workspaceId));
  }
  return null;
}
