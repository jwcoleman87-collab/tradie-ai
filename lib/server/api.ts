import { z } from 'zod';
import { Uuid, ChatInput, CaseInput, type Action } from '../contracts';
import { adminDb, authenticate, checked, membership, rpc } from './db';
import { body, endpoint, json } from './http';
import { publicConfig } from './config';
import { AppError, requireValue } from './errors';
import { runTeam } from './ai';
import { createAIProvider } from './ai-provider';
import { AIConsentInput, type AIPreferences } from '../ai-settings';
import { executeAction } from './actions';
import { calendarContext } from './calendar';
import { finishGoogle, startGoogle } from './oauth';
import { readFileBody, safeFilename, validateFile } from './uploads';
import { integrationApi } from './integration-api';
import { finishProvider } from './provider-oauth';
import { AdditionalProviderSchema, connectionList } from './connections';
import { aiProblem } from '../ai-diagnostics';

export const api = endpoint(async (request) => {
  const url = new URL(request.url),
    path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, ''),
    method = request.method;
  if (path === 'config' && method === 'GET') return json(publicConfig());
  if (path === 'health' && method === 'GET')
    return json({
      status: publicConfig().configured ? 'configured' : 'setup_required',
    });
  if (path === 'google/callback' && method === 'GET')
    return finishGoogle(request);
  const providerCallback = path.match(
    /^integrations\/(facebook|google_ads)\/callback$/,
  );
  if (providerCallback && method === 'GET')
    return finishProvider(
      AdditionalProviderSchema.parse(providerCallback[1]),
      request,
    );
  const { db, user } = await authenticate(request);
  const admin = adminDb();
  const integrationResponse = await integrationApi(request, path, db, user.id);
  if (integrationResponse) return integrationResponse;
  if (path === 'bootstrap' && method === 'POST') {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(120) })
      .strict()
      .parse(await body(request));
    return json({
      workspaceId: await rpc(db, 'bootstrap_workspace', { p_name: name }),
    });
  }
  if (path === 'state' && method === 'GET') {
    const workspaces =
      checked(
        await db
          .from('workspaces')
          .select(
            'id,name,time_zone,ai_consent_at,ai_primary_provider,ai_fallback_enabled,ai_allowed_providers',
          )
          .order('created_at'),
      ) || [];
    if (!workspaces.length) return json({ workspaces: [] });
    const workspaceId = Uuid.parse(
      url.searchParams.get('workspaceId') || workspaces[0].id,
    );
    const role = await membership(db, user.id, workspaceId);
    const workspace = workspaces.find((w) => w.id === workspaceId);
    requireValue(workspace, 'NOT_FOUND', 404);
    const conversations =
      checked(
        await db
          .from('conversations')
          .select('id,title,created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(100),
      ) || [];
    const conversationId =
      url.searchParams.get('conversationId') || conversations[0]?.id || null;
    if (conversationId) {
      Uuid.parse(conversationId);
      requireValue(
        conversations.some((c) => c.id === conversationId),
        'NOT_FOUND',
        404,
      );
    }
    const [
      messages,
      actions,
      uploads,
      cases,
      records,
      audit,
      runs,
      connection,
    ] = await Promise.all([
      conversationId
        ? db
            .from('messages')
            .select('id,role,content,created_at,attachment_ids')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
      db
        .from('proposed_actions')
        .select(
          'id,workspace_id,conversation_id,agent,action_type,summary,payload,status,expires_at,error_code,execution_result,created_at',
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      conversationId
        ? db
            .from('uploaded_files')
            .select('id,filename,mime_type,size_bytes,status')
            .eq('conversation_id', conversationId)
            .eq('status', 'ready')
            .order('created_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
      db
        .from('escalation_cases')
        .select(
          'id,case_id,problem,solution,outcome,status,shared_with_support',
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('business_records')
        .select('id,kind,title,body,source,created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('audit_logs')
        .select('id,event,entity_id,metadata,created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(30),
      conversationId
        ? db
            .from('agent_runs')
            .select(
              'id,agents,status,model,error_code,provider_trace,created_at,finished_at',
            )
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('integration_credentials')
        .select('connection_id')
        .eq('workspace_id', workspaceId)
        .eq('provider', 'google_calendar')
        .eq('status', 'connected')
        .maybeSingle(),
    ]);
    return json({
      workspaces,
      workspace,
      role,
      conversations,
      conversationId,
      messages: (checked(messages) || []).reverse(),
      actions: checked(actions),
      uploads: checked(uploads),
      cases: checked(cases),
      records: checked(records),
      audit: (checked(audit) || []).map(({ metadata, ...entry }) => ({
        ...entry,
        errorCode:
          typeof metadata?.error_code === 'string' &&
          /^[A-Z_]{1,80}$/.test(metadata.error_code)
            ? metadata.error_code
            : undefined,
      })),
      runs: checked(runs),
      calendarConnected: !!checked(connection),
    });
  }
  if (path === 'consent' && method === 'POST') {
    const input = AIConsentInput.parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    checked(
      await admin
        .from('workspaces')
        .update({
          ai_consent_at: input.allowAI ? new Date().toISOString() : null,
          ai_primary_provider: input.primaryProvider,
          ai_fallback_enabled: input.allowFallback,
          ai_allowed_providers: input.allowedProviders,
        })
        .eq('id', input.workspaceId),
    );
    return json({ ok: true });
  }
  if (path === 'conversations' && method === 'POST') {
    const input = z
      .object({
        workspaceId: Uuid,
        title: z.string().trim().min(1).max(120).default('New conversation'),
      })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, input.workspaceId);
    await rpc(admin, 'consume_rate', {
      p_workspace: input.workspaceId,
      p_user: user.id,
      p_operation: 'conversation',
      p_limit: 10,
    });
    return json(
      checked(
        await admin
          .from('conversations')
          .insert({
            workspace_id: input.workspaceId,
            created_by: user.id,
            title: input.title,
          })
          .select('id')
          .single(),
      ),
      201,
    );
  }
  if (path === 'chat' && method === 'POST') {
    const input = ChatInput.parse(await body(request));
    await membership(db, user.id, input.workspaceId);
    const preferences = checked(
      await db
        .from('workspaces')
        .select(
          'ai_consent_at,ai_primary_provider,ai_fallback_enabled,ai_allowed_providers',
        )
        .eq('id', input.workspaceId)
        .single(),
    )!;
    requireValue(
      preferences.ai_consent_at,
      'AI_CONSENT_REQUIRED',
      403,
      'Choose your AI providers in Connections before sending a message.',
    );
    const provider = createAIProvider(preferences as AIPreferences);
    const run = await rpc<{ id: string; status: string; existing: boolean }>(
      admin,
      'begin_chat',
      {
        p_workspace: input.workspaceId,
        p_conversation: input.conversationId,
        p_user: user.id,
        p_request: input.requestId,
        p_text: input.text,
        p_files: input.attachmentIds,
      },
    );
    if (run.existing) {
      const previous = checked(
        await db
          .from('agent_runs')
          .select('error_code')
          .eq('id', run.id)
          .eq('workspace_id', input.workspaceId)
          .single(),
      );
      return json(
        {
          runId: run.id,
          status: run.status,
          messageSaved: true,
          ...(run.status === 'failed'
            ? {
                error: {
                  code: previous?.error_code || 'AI_FAILED',
                  message: aiProblem(previous?.error_code),
                },
              }
            : {}),
        },
        run.status === 'working' ? 202 : 200,
      );
    }
    try {
      const history = (
        checked(
          await db
            .from('messages')
            .select('role,content')
            .eq('conversation_id', input.conversationId)
            .order('created_at', { ascending: false })
            .limit(30),
        ) || []
      ).reverse();
      const records =
        checked(
          await db
            .from('business_records')
            .select('kind,title,body,source')
            .eq('workspace_id', input.workspaceId)
            .order('created_at', { ascending: false })
            .limit(30),
        ) || [];
      const workspace = checked(
        await db
          .from('workspaces')
          .select('time_zone')
          .eq('id', input.workspaceId)
          .single(),
      )!;
      const connection = checked(
        await admin
          .from('integration_credentials')
          .select('connection_id')
          .eq('workspace_id', input.workspaceId)
          .eq('provider', 'google_calendar')
          .eq('status', 'connected')
          .maybeSingle(),
      );
      const attachments: unknown[] = [];
      let attachmentBytes = 0;
      for (const id of new Set(input.attachmentIds)) {
        const file = checked(
          await db
            .from('uploaded_files')
            .select('filename,mime_type,object_path,size_bytes')
            .eq('id', id)
            .eq('workspace_id', input.workspaceId)
            .eq('conversation_id', input.conversationId)
            .eq('status', 'ready')
            .single(),
        )!;
        attachmentBytes += file.size_bytes;
        requireValue(
          attachmentBytes <= 20 * 1024 * 1024,
          'ATTACHMENT_TOTAL_TOO_LARGE',
          413,
          'Choose files totalling 20 MB or less per message.',
        );
        const data = checked(
          await db.storage.from('workspace-files').download(file.object_path),
        )!;
        const bytes = Buffer.from(await data.arrayBuffer());
        if (file.mime_type.startsWith('image/'))
          attachments.push({
            type: 'input_image',
            image_url: `data:${file.mime_type};base64,${bytes.toString('base64')}`,
            detail: 'auto',
          });
        else if (file.mime_type === 'application/pdf')
          attachments.push({
            type: 'input_file',
            filename: file.filename,
            file_data: `data:application/pdf;base64,${bytes.toString('base64')}`,
          });
        else
          attachments.push({
            type: 'input_text',
            text: `Untrusted uploaded document ${file.filename}:\n${bytes.toString('utf8').slice(0, 20000)}`,
          });
      }
      // Bound model context independently of the stored conversation length.
      let remaining = 65000;
      const bounded = history
        .slice()
        .reverse()
        .filter((m) => {
          remaining -= m.content.length;
          return remaining >= 0;
        })
        .reverse();
      const integrations = await connectionList(input.workspaceId);
      const result = await runTeam(provider, {
        history: bounded,
        records: records.map((r) => ({ ...r, body: r.body.slice(0, 3000) })),
        timeZone: workspace.time_zone,
        calendar: connection
          ? await calendarContext(input.workspaceId)
          : { available: false },
        attachments,
        integrations,
      });
      requireValue(
        connection ||
          !result.proposals.some((p) => p.type === 'calendar.create'),
        'CALENDAR_NOT_CONNECTED',
        409,
        'Connect Google Calendar first, then ask your team to prepare the booking.',
      );
      const facebook = integrations.find(
        (c) =>
          c.provider === 'facebook' &&
          c.capabilities.includes('facebook.publish'),
      );
      requireValue(
        !result.proposals.some(
          (p) =>
            p.type === 'facebook.publish' &&
            (!facebook || p.payload.pageId !== facebook.externalId),
        ),
        'FACEBOOK_NOT_CONNECTED',
        409,
        'Connect and select a Facebook Page with publishing enabled first.',
      );
      await rpc(admin, 'complete_chat', {
        p_run: run.id,
        p_reply: result.reply,
        p_agents: result.agents,
        p_versions: result.versions,
        p_model: result.model,
        p_usage: result.usage,
        p_trace: result.providerTrace,
        p_proposals: result.proposals.map((p) => ({
          ...p,
          connectionId:
            p.type === 'calendar.create'
              ? connection?.connection_id
              : p.type === 'facebook.publish'
                ? facebook?.connectionId
                : null,
        })),
      });
      let notice: string | undefined;
      if (result.escalation !== 'none') {
        // No AI-authored free text or transcript is included in escalation.
        // The reply is already committed. A case failure must not relabel it failed.
        try {
          checked(
            await admin.from('escalation_cases').insert({
              workspace_id: input.workspaceId,
              conversation_id: input.conversationId,
              agent: result.agents[0],
              category: result.escalation,
              problem:
                'The AI team needs clarification or a specialist review. Please review this conversation in your private workspace.',
              created_by: user.id,
            }),
          );
        } catch {
          notice =
            'Your reply is saved, but the Ask James case could not be created. Open Ask James to request help.';
          console.error(
            JSON.stringify({ event: 'chat_escalation_failed', runId: run.id }),
          );
        }
      }
      return json({
        runId: run.id,
        status: 'completed',
        messageSaved: true,
        agents: result.agents,
        providerTrace: result.providerTrace,
        ...(notice ? { notice } : {}),
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AI_FAILED';
      try {
        const updated = await admin
          .from('agent_runs')
          .update({
            status: 'failed',
            error_code: code,
            usage: provider.usage,
            provider_trace: provider.attempts,
            finished_at: new Date().toISOString(),
          })
          .eq('id', run.id)
          .eq('status', 'working')
          .select('id');
        checked(updated);
        if (updated.data?.length) {
          const auditResult = await admin.from('audit_logs').insert({
            workspace_id: input.workspaceId,
            actor_id: user.id,
            event: 'chat.failed',
            entity_id: run.id,
            metadata: { error_code: code, provider_trace: provider.attempts },
          });
          checked(auditResult);
        }
      } catch {
        // Keep the saved-message receipt even if failure/audit persistence is down.
        console.error(
          JSON.stringify({
            event: 'chat_failure_persist_failed',
            runId: run.id,
          }),
        );
      }
      console.error(
        JSON.stringify({
          event: 'chat.failed',
          runId: run.id,
          code,
          providerTrace: provider.attempts,
        }),
      );
      return json(
        {
          runId: run.id,
          status: 'failed',
          messageSaved: true,
          error: { code, message: aiProblem(code) },
        },
        error instanceof AppError ? error.status : 500,
      );
    }
  }
  const decisionMatch = path.match(/^actions\/([^/]+)\/decision$/);
  if (decisionMatch && method === 'POST') {
    const actionId = Uuid.parse(decisionMatch[1]);
    const input = z
      .object({ decision: z.enum(['accept', 'deny']) })
      .strict()
      .parse(await body(request));
    const action = checked(
      await db
        .from('proposed_actions')
        .select('workspace_id')
        .eq('id', actionId)
        .maybeSingle(),
    );
    requireValue(action, 'NOT_FOUND', 404);
    await membership(db, user.id, action.workspace_id, true);
    return json(
      await rpc<Action>(admin, 'decide_action', {
        p_action: actionId,
        p_user: user.id,
        p_decision: input.decision,
      }),
    );
  }
  const executeMatch = path.match(/^actions\/([^/]+)\/execute$/);
  if (executeMatch && method === 'POST') {
    const id = Uuid.parse(executeMatch[1]);
    z.object({})
      .strict()
      .parse(await body(request));
    const action = checked(
      await db
        .from('proposed_actions')
        .select('workspace_id')
        .eq('id', id)
        .maybeSingle(),
    );
    requireValue(action, 'NOT_FOUND', 404);
    await membership(db, user.id, action.workspace_id, true);
    return json(await executeAction(id, user.id));
  }
  if (path === 'uploads' && method === 'POST') {
    const workspaceId = Uuid.parse(url.searchParams.get('workspaceId')),
      conversationId = Uuid.parse(url.searchParams.get('conversationId'));
    await membership(db, user.id, workspaceId);
    const conversation = checked(
      await db
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId)
        .maybeSingle(),
    );
    requireValue(conversation, 'NOT_FOUND', 404);
    await rpc(admin, 'consume_rate', {
      p_workspace: workspaceId,
      p_user: user.id,
      p_operation: 'upload',
      p_limit: 10,
    });
    const bytes = await readFileBody(request),
      mime = request.headers.get('content-type')?.split(';')[0] || '';
    validateFile(bytes, mime);
    const filename = safeFilename(url.searchParams.get('filename') || 'upload'),
      id = crypto.randomUUID(),
      objectPath = `${workspaceId}/${id}/${filename}`;
    const hash = Buffer.from(
      await crypto.subtle.digest('SHA-256', bytes),
    ).toString('hex');
    checked(
      await admin.from('uploaded_files').insert({
        id,
        workspace_id: workspaceId,
        conversation_id: conversationId,
        uploaded_by: user.id,
        filename,
        object_path: objectPath,
        mime_type: mime,
        size_bytes: bytes.length,
        sha256: hash,
        status: 'uploading',
      }),
    );
    try {
      checked(
        await admin.storage
          .from('workspace-files')
          .upload(objectPath, bytes, { contentType: mime, upsert: false }),
      );
      checked(
        await admin
          .from('uploaded_files')
          .update({ status: 'ready' })
          .eq('id', id),
      );
    } catch (error) {
      await admin.storage.from('workspace-files').remove([objectPath]);
      await admin
        .from('uploaded_files')
        .update({ status: 'failed' })
        .eq('id', id);
      throw error;
    }
    return json(
      {
        id,
        filename,
        mime_type: mime,
        size_bytes: bytes.length,
        status: 'ready',
      },
      201,
    );
  }
  const fileMatch = path.match(/^uploads\/([^/]+)\/url$/);
  if (fileMatch && method === 'GET') {
    const id = Uuid.parse(fileMatch[1]);
    const file = checked(
      await db
        .from('uploaded_files')
        .select('object_path,filename')
        .eq('id', id)
        .eq('status', 'ready')
        .maybeSingle(),
    );
    requireValue(file, 'NOT_FOUND', 404);
    return json(
      checked(
        await db.storage
          .from('workspace-files')
          .createSignedUrl(file.object_path, 60, { download: file.filename }),
      ),
    );
  }
  if (path === 'cases' && method === 'POST') {
    const input = CaseInput.parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    return json(
      await rpc(admin, 'create_case', {
        p_workspace: input.workspaceId,
        p_conversation: input.conversationId,
        p_user: user.id,
        p_agent: input.agent,
        p_category: input.category,
        p_problem: input.problem,
        p_share: input.shareWithSupport,
      }),
      201,
    );
  }
  const caseMatch = path.match(/^cases\/([^/]+)$/);
  if (caseMatch && method === 'PATCH') {
    const id = Uuid.parse(caseMatch[1]);
    const input = z
      .object({
        solution: z.string().min(1).max(2000),
        outcome: z.string().min(1).max(2000),
      })
      .strict()
      .parse(await body(request));
    await rpc(admin, 'resolve_case', {
      p_case: id,
      p_user: user.id,
      p_solution: input.solution,
      p_outcome: input.outcome,
    });
    return json({ ok: true });
  }
  if (path === 'support' && method === 'GET') {
    requireValue(
      await rpc(db, 'is_support_operator', {}),
      'SUPPORT_FORBIDDEN',
      403,
    );
    return json(
      checked(
        await db
          .from('support_cases')
          .select('case_id,payload,status,solution,outcome')
          .order('updated_at', { ascending: false })
          .limit(100),
      ),
    );
  }
  if (path === 'google/start' && method === 'POST') {
    const input = z
      .object({ workspaceId: Uuid })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    await rpc(admin, 'consume_rate', {
      p_workspace: input.workspaceId,
      p_user: user.id,
      p_operation: 'oauth',
      p_limit: 5,
    });
    return startGoogle(input.workspaceId, user.id);
  }
  if (path === 'google/disconnect' && method === 'POST') {
    const input = z
      .object({ workspaceId: Uuid })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    checked(
      await admin
        .from('integration_credentials')
        .delete()
        .eq('workspace_id', input.workspaceId)
        .eq('provider', 'google_calendar'),
    );
    return json({ ok: true });
  }
  throw new AppError('NOT_FOUND', 404, 'This endpoint does not exist.');
});
