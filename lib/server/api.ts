import { z } from 'zod';
import {
  Uuid,
  ChatInput,
  CaseInput,
  type Action,
  type ChatMessage,
} from '../contracts';
import { adminDb, authenticate, checked, membership, rpc } from './db';
import { body, endpoint, json, noStore } from './http';
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
import {
  AdditionalProviderSchema,
  connectionList,
  disconnectIntegration,
} from './connections';
import { aiProblem } from '../ai-diagnostics';
import { onboardingApi } from './onboarding-api';
import { preferredWorkspace } from '../workspace-selection';
import {
  CHAT_DEADLINE_MS,
  CHAT_WORK_MS,
  callSignal,
  withinBudget,
  mapConcurrent,
} from './chat-budget';

export const api = endpoint(async (request) => {
  const requestStartedAt = Date.now();
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
  const authenticationMs = Date.now() - requestStartedAt;
  const admin = adminDb();
  const onboardingResponse = await onboardingApi(request, path, db, user.id);
  if (onboardingResponse) return onboardingResponse;
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
            'id,name,time_zone,ai_consent_at,ai_primary_provider,ai_fallback_enabled,ai_allowed_providers,workspace_type,status,archived_at',
          )
          .order('status')
          .order('created_at'),
      ) || [];
    if (!workspaces.length) return json({ workspaces: [] });
    const requestedWorkspaceId = url.searchParams.get('workspaceId');
    if (requestedWorkspaceId) Uuid.parse(requestedWorkspaceId);
    const confirmedProfiles = requestedWorkspaceId
      ? []
      : checked(
          await db
            .from('business_profiles')
            .select('workspace_id')
            .eq('onboarding_status', 'confirmed'),
        ) || [];
    const workspace = preferredWorkspace(
      workspaces,
      new Set(confirmedProfiles.map((profile) => profile.workspace_id)),
      requestedWorkspaceId,
    );
    requireValue(workspace, 'NOT_FOUND', 404);
    const workspaceId = Uuid.parse(workspace.id);
    const role = await membership(db, user.id, workspaceId);
    const conversations =
      checked(
        await db
          .from('conversations')
          .select('id,title,status,archived_at,created_at')
          .eq('workspace_id', workspaceId)
          .order('status')
          .order('created_at', { ascending: false })
          .limit(100),
      ) || [];
    const conversationId =
      url.searchParams.get('conversationId') ||
      conversations.find((conversation) => conversation.status === 'active')
        ?.id ||
      null;
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
      businessProfile,
    ] = await Promise.all([
      conversationId
        ? db
            .from('messages')
            .select('id,run_id,role,content,created_at,attachment_ids')
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
        .select(
          'id,kind,title,body,source,status,archived_at,retention_class,legal_hold,created_at',
        )
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
              'id,request_id,agents,status,model,error_code,provider_trace,created_at,finished_at',
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
      db
        .from('business_profiles')
        .select('onboarding_status,base_location,services')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
    ]);
    const profile = checked(businessProfile);
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
      onboardingStatus: profile?.onboarding_status || null,
      businessProfile: profile
        ? {
            base_location: profile.base_location,
            services: profile.services || [],
          }
        : null,
    });
  }
  if (path === 'workspaces' && method === 'POST') {
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        workspaceType: z.enum(['business', 'sandbox']).default('business'),
      })
      .strict()
      .parse(await body(request));
    return json(
      {
        id: await rpc<string>(admin, 'create_workspace', {
          p_name: input.name,
          p_user: user.id,
          p_workspace_type: input.workspaceType,
        }),
      },
      201,
    );
  }
  const workspaceMatch = path.match(/^workspaces\/([^/]+)$/);
  if (workspaceMatch && method === 'PATCH') {
    const workspaceId = Uuid.parse(workspaceMatch[1]);
    const input = z
      .object({
        name: z.string().trim().min(1).max(120),
        workspaceType: z.enum(['business', 'sandbox']),
      })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, workspaceId, true);
    await rpc(admin, 'update_workspace', {
      p_workspace: workspaceId,
      p_user: user.id,
      p_name: input.name,
      p_workspace_type: input.workspaceType,
    });
    return json({ ok: true });
  }
  const workspaceStatusMatch = path.match(/^workspaces\/([^/]+)\/status$/);
  if (workspaceStatusMatch && method === 'PATCH') {
    const workspaceId = Uuid.parse(workspaceStatusMatch[1]);
    const input = z
      .object({ status: z.enum(['active', 'archived']) })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, workspaceId, true);
    await rpc(admin, 'set_workspace_status', {
      p_workspace: workspaceId,
      p_user: user.id,
      p_status: input.status,
    });
    return json({ ok: true });
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
    const activeWorkspace = checked(
      await db
        .from('workspaces')
        .select('status')
        .eq('id', input.workspaceId)
        .single(),
    );
    requireValue(
      activeWorkspace?.status === 'active',
      'WORKSPACE_ARCHIVED',
      409,
      'Restore this workspace before creating new work.',
    );
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
  const conversationStatusMatch = path.match(
    /^conversations\/([^/]+)\/status$/,
  );
  if (conversationStatusMatch && method === 'PATCH') {
    const conversationId = Uuid.parse(conversationStatusMatch[1]);
    const input = z
      .object({
        workspaceId: Uuid,
        status: z.enum(['active', 'archived']),
      })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    await rpc(admin, 'set_conversation_status', {
      p_workspace: input.workspaceId,
      p_conversation: conversationId,
      p_user: user.id,
      p_status: input.status,
    });
    return json({ ok: true });
  }
  const recordStatusMatch = path.match(/^records\/([^/]+)\/status$/);
  if (recordStatusMatch && method === 'PATCH') {
    const recordId = Uuid.parse(recordStatusMatch[1]);
    const input = z
      .object({
        workspaceId: Uuid,
        status: z.enum(['active', 'archived']),
      })
      .strict()
      .parse(await body(request));
    await membership(db, user.id, input.workspaceId, true);
    await rpc(admin, 'set_record_status', {
      p_workspace: input.workspaceId,
      p_record: recordId,
      p_user: user.id,
      p_status: input.status,
    });
    return json({ ok: true });
  }
  if (path === 'chat/status' && method === 'GET') {
    const workspaceId = Uuid.parse(url.searchParams.get('workspaceId'));
    const requestId = Uuid.parse(url.searchParams.get('requestId'));
    await membership(db, user.id, workspaceId);
    const receipt = await rpc<
      { id: string; status: string; errorCode?: string } & Record<
        string,
        unknown
      >
    >(admin, 'read_chat_receipt', {
      p_workspace: workspaceId,
      p_user: user.id,
      p_request: requestId,
    });
    return json({
      ...receipt,
      runId: receipt.id,
      requestId,
      messageSaved: true,
      ...(receipt.status === 'failed'
        ? {
            error: {
              code: receipt.errorCode || 'AI_FAILED',
              message: aiProblem(receipt.errorCode),
            },
          }
        : {}),
    });
  }
  if (path === 'chat' && method === 'POST') {
    const input = ChatInput.parse(await body(request));
    await membership(db, user.id, input.workspaceId);
    const preferences = checked(
      await db
        .from('workspaces')
        .select(
          'status,ai_consent_at,ai_primary_provider,ai_fallback_enabled,ai_allowed_providers',
        )
        .eq('id', input.workspaceId)
        .single(),
    )!;
    requireValue(
      preferences.status === 'active',
      'WORKSPACE_ARCHIVED',
      409,
      'Restore this workspace before sending new work.',
    );
    const activeConversation = checked(
      await db
        .from('conversations')
        .select('status')
        .eq('workspace_id', input.workspaceId)
        .eq('id', input.conversationId)
        .single(),
    );
    requireValue(
      activeConversation?.status === 'active',
      'CONVERSATION_ARCHIVED',
      409,
      'Restore this conversation before sending a message.',
    );
    requireValue(
      preferences.ai_consent_at,
      'AI_CONSENT_REQUIRED',
      403,
      'Choose your AI providers in Connections before sending a message.',
    );
    const provider = createAIProvider(preferences as AIPreferences);
    const run = await rpc<{
      id: string;
      status: string;
      existing: boolean;
      userMessageId?: string;
      leaseExpiresAt?: string;
      assistantMessage?: ChatMessage;
      errorCode?: string;
    }>(admin, 'begin_chat', {
      p_workspace: input.workspaceId,
      p_conversation: input.conversationId,
      p_user: user.id,
      p_request: input.requestId,
      p_text: input.text,
      p_files: input.attachmentIds,
    });
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
          requestId: input.requestId,
          userMessageId: run.userMessageId,
          leaseExpiresAt: run.leaseExpiresAt,
          status: run.status,
          messageSaved: true,
          ...(run.assistantMessage
            ? { assistantMessage: run.assistantMessage }
            : {}),
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
    const cancellation = new AbortController();
    const leaseStartedAt = run.leaseExpiresAt
      ? Date.parse(run.leaseExpiresAt) - 150000
      : Date.now();
    const remainingTotal = Math.max(
      1,
      Math.min(
        CHAT_DEADLINE_MS,
        leaseStartedAt + CHAT_DEADLINE_MS - Date.now(),
      ),
    );
    const totalSignal = AbortSignal.any([
      cancellation.signal,
      request.signal,
      AbortSignal.timeout(remainingTotal),
    ]);
    const workSignal = AbortSignal.any([
      totalSignal,
      AbortSignal.timeout(
        Math.max(1, Math.min(CHAT_WORK_MS, remainingTotal - 10000)),
      ),
    ]);
    const startedAt = Date.now();
    const timings: { stage: string; elapsedMs: number }[] = [
      { stage: 'authentication', elapsedMs: authenticationMs },
      {
        stage: 'acceptance',
        elapsedMs: Date.now() - requestStartedAt - authenticationMs,
      },
    ];
    let stageStarted = startedAt;
    let previousStage = 'accepted';
    let emit: (value: Record<string, unknown>) => void = () => {};
    const progress = (stage: string) => {
      const now = Date.now();
      if (previousStage === 'context' || previousStage === 'persistence')
        timings.push({ stage: previousStage, elapsedMs: now - stageStarted });
      previousStage = stage;
      stageStarted = now;
      emit({
        type: 'progress',
        requestId: input.requestId,
        runId: run.id,
        stage,
      });
    };
    const execute = async () => {
      try {
        progress('context');
        const contextSignal = callSignal({ signal: workSignal }, 15000);
        const [historyResult, workspaceResult, connectionResult, integrations] =
          await withinBudget(
            Promise.all([
              db
                .from('messages')
                .select('role,content,attachment_ids')
                .eq('conversation_id', input.conversationId)
                .order('created_at', { ascending: false })
                .limit(20)
                .abortSignal(contextSignal),
              db
                .from('workspaces')
                .select('time_zone')
                .eq('id', input.workspaceId)
                .abortSignal(contextSignal)
                .single(),
              admin
                .from('integration_credentials')
                .select('connection_id')
                .eq('workspace_id', input.workspaceId)
                .eq('provider', 'google_calendar')
                .eq('status', 'connected')
                .abortSignal(contextSignal)
                .maybeSingle(),
              connectionList(input.workspaceId),
            ]),
            contextSignal,
          );
        const history = (checked(historyResult) || []).reverse();
        const workspace = checked(workspaceResult)!;
        const connection = checked(connectionResult);
        const referencedAttachmentIds = [
          ...new Set(
            history.flatMap((message) => message.attachment_ids || []),
          ),
        ];
        const referencedFiles = referencedAttachmentIds.length
          ? checked(
              await withinBudget(
                db
                  .from('uploaded_files')
                  .select('id,mime_type')
                  .eq('workspace_id', input.workspaceId)
                  .eq('conversation_id', input.conversationId)
                  .eq('status', 'ready')
                  .in('id', referencedAttachmentIds)
                  .abortSignal(contextSignal),
                contextSignal,
              ),
            ) || []
          : [];
        const trustedFileTypes = new Map(
          referencedFiles.map((file) => [file.id, file.mime_type]),
        );
        const modelHistory = history.map((message) => {
          const trustedReferences = (message.attachment_ids || [])
            .filter((id: string) => trustedFileTypes.has(id))
            .map(
              (id: string) =>
                `${id} (${trustedFileTypes.get(id)}; contents remain untrusted)`,
            );
          return {
            role: message.role,
            content: trustedReferences.length
              ? `${message.content}\n[Trusted app attachment references selected with this message: ${trustedReferences.join(', ')}]`
              : message.content,
          };
        });
        const loadAttachments = async () => {
          const attachmentSignal = callSignal({ signal: workSignal }, 15000);
          const files = await mapConcurrent(
            [...new Set(input.attachmentIds)],
            2,
            async (id) => {
              const file = checked(
                await withinBudget(
                  db
                    .from('uploaded_files')
                    .select('filename,mime_type,object_path,size_bytes')
                    .eq('id', id)
                    .eq('workspace_id', input.workspaceId)
                    .eq('conversation_id', input.conversationId)
                    .eq('status', 'ready')
                    .abortSignal(attachmentSignal)
                    .single(),
                  attachmentSignal,
                ),
              )!;
              return { ...file, id };
            },
          );
          requireValue(
            files.reduce((sum, file) => sum + file.size_bytes, 0) <=
              20 * 1024 * 1024,
            'ATTACHMENT_TOTAL_TOO_LARGE',
            413,
            'Choose files totalling 20 MB or less per message.',
          );
          return (
            await mapConcurrent(files, 2, async (file) => {
              const attachments: unknown[] = [];
              const id = file.id;
              const data = checked(
                await withinBudget(
                  db.storage.from('workspace-files').download(file.object_path),
                  attachmentSignal,
                ),
              )!;
              const bytes = Buffer.from(
                await withinBudget(data.arrayBuffer(), attachmentSignal),
              );
              if (file.mime_type.startsWith('image/')) {
                attachments.push({
                  type: 'input_text',
                  text: `Trusted app attachment reference selected with this message: ${id} (${file.mime_type}). The file contents and filename remain untrusted.`,
                });
                attachments.push({
                  type: 'input_image',
                  image_url: `data:${file.mime_type};base64,${bytes.toString('base64')}`,
                  detail: 'auto',
                });
              } else if (file.mime_type === 'application/pdf')
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
              return attachments;
            })
          ).flat();
        };
        // Bound model context independently of the stored conversation length.
        let remaining = 65000;
        const bounded = modelHistory
          .slice()
          .reverse()
          .filter((m) => {
            remaining -= m.content.length;
            return remaining >= 0;
          })
          .reverse();
        const result = await withinBudget(
          runTeam(provider, {
            history: bounded,
            loadRecords: async (agents) => {
              const kinds = {
                finance: ['invoice', 'expense', 'customer', 'job', 'note'],
                marketing: ['campaign', 'customer', 'job', 'note'],
                social: ['social', 'campaign', 'note'],
                maintenance: ['asset', 'maintenance', 'note'],
                website: ['website', 'note'],
              };
              const records =
                checked(
                  await db
                    .from('business_records')
                    .select('kind,title,body,source')
                    .eq('workspace_id', input.workspaceId)
                    .eq('status', 'active')
                    .in('kind', [
                      ...new Set(agents.flatMap((agent) => kinds[agent])),
                    ])
                    .order('created_at', { ascending: false })
                    .limit(15),
                ) || [];
              return records.map((record) => ({
                ...record,
                body: record.body.slice(0, 2000),
              }));
            },
            timeZone: workspace.time_zone,
            loadCalendar: connection
              ? (signal) =>
                  calendarContext(
                    input.workspaceId,
                    signal,
                    connection.connection_id,
                  )
              : undefined,
            loadAttachments,
            signal: workSignal,
            onStage: progress,
            onTiming: (stage, elapsedMs) => timings.push({ stage, elapsedMs }),
            integrations,
          }),
          workSignal,
        );
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
        for (const proposal of result.proposals) {
          if (
            proposal.type !== 'facebook.publish' ||
            !proposal.payload.imageFileId
          )
            continue;
          const image = checked(
            await withinBudget(
              db
                .from('uploaded_files')
                .select('id')
                .eq('id', proposal.payload.imageFileId)
                .eq('workspace_id', input.workspaceId)
                .eq('conversation_id', input.conversationId)
                .eq('status', 'ready')
                .in('mime_type', ['image/jpeg', 'image/png'])
                .lte('size_bytes', 4 * 1024 * 1024)
                .maybeSingle(),
              workSignal,
            ),
          );
          requireValue(
            image,
            'FACEBOOK_IMAGE_INVALID',
            409,
            'Choose one ready JPEG or PNG image under 4 MB from this conversation.',
          );
        }
        if (workSignal.aborted) throw new AppError('AI_TIMEOUT', 503);
        progress('persistence');
        await withinBudget(
          rpc(admin, 'complete_chat', {
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
          }),
          totalSignal,
        );
        let assistantMessage;
        try {
          assistantMessage = checked(
            await withinBudget(
              db
                .from('messages')
                .select('id,run_id,role,content,created_at,attachment_ids')
                .eq('run_id', run.id)
                .eq('role', 'assistant')
                .abortSignal(totalSignal)
                .maybeSingle(),
              totalSignal,
            ),
          );
        } catch {
          /* The committed reply can also be read by the status endpoint. */
        }
        let notice: string | undefined;
        if (result.escalation !== 'none') {
          // No AI-authored free text or transcript is included in escalation.
          // The reply is already committed. A case failure must not relabel it failed.
          try {
            checked(
              await withinBudget(
                admin.from('escalation_cases').insert({
                  workspace_id: input.workspaceId,
                  conversation_id: input.conversationId,
                  agent: result.agents[0],
                  category: result.escalation,
                  problem:
                    'The Workbench crew needs clarification or a specialist review. Please review this conversation in your private workspace.',
                  created_by: user.id,
                }),
                totalSignal,
              ),
            );
          } catch {
            notice =
              'Your reply is saved, but the Ask James case could not be created. Open Ask James to request help.';
            console.error(
              JSON.stringify({
                event: 'chat_escalation_failed',
                runId: run.id,
              }),
            );
          }
        }
        return json({
          runId: run.id,
          requestId: input.requestId,
          userMessageId: run.userMessageId,
          status: 'completed',
          messageSaved: true,
          agents: result.agents,
          providerTrace: result.providerTrace,
          ...(assistantMessage?.role === 'assistant'
            ? { assistantMessage }
            : {}),
          ...(notice ? { notice } : {}),
        });
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'AI_FAILED';
        const failureSignal = AbortSignal.timeout(
          Math.max(
            1,
            Math.min(5000, startedAt + CHAT_DEADLINE_MS - Date.now()),
          ),
        );
        let failurePersisted = false;
        try {
          const updated = await withinBudget(
            admin
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
              .abortSignal(failureSignal)
              .select('id'),
            failureSignal,
          );
          checked(updated);
          if (updated.data?.length) {
            failurePersisted = true;
            const auditResult = await withinBudget(
              admin.from('audit_logs').insert({
                workspace_id: input.workspaceId,
                actor_id: user.id,
                event: 'chat.failed',
                entity_id: run.id,
                metadata: {
                  error_code: code,
                  provider_trace: provider.attempts,
                },
              }),
              failureSignal,
            );
            checked(auditResult);
          } else {
            // The atomic completion may have won a race against cancellation.
            // Report that persisted outcome instead of relabelling it failed.
            const receipt = await withinBudget(
              rpc<
                { id: string; status: string; errorCode?: string } & Record<
                  string,
                  unknown
                >
              >(admin, 'read_chat_receipt', {
                p_workspace: input.workspaceId,
                p_user: user.id,
                p_request: input.requestId,
              }),
              failureSignal,
            );
            if (
              receipt &&
              ['completed', 'failed', 'working'].includes(receipt.status)
            )
              return json({
                ...receipt,
                runId: run.id,
                messageSaved: true,
                ...(receipt.status === 'failed'
                  ? {
                      error: {
                        code: receipt.errorCode || 'AI_FAILED',
                        message: aiProblem(receipt.errorCode),
                      },
                    }
                  : {}),
              });
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
            event: failurePersisted ? 'chat.failed' : 'chat.outcome_pending',
            runId: run.id,
            code,
            providerTrace: provider.attempts,
          }),
        );
        // A timed-out atomic commit can still have won on the database. Never
        // publish a terminal failure until the durable failure is confirmed.
        if (!failurePersisted)
          return json(
            {
              runId: run.id,
              requestId: input.requestId,
              userMessageId: run.userMessageId,
              messageSaved: true,
              status: 'working',
              notice:
                'Your message is saved. Checking the final saved outcome automatically.',
            },
            202,
          );
        return json(
          {
            runId: run.id,
            status: 'failed',
            requestId: input.requestId,
            userMessageId: run.userMessageId,
            messageSaved: true,
            error: { code, message: aiProblem(code) },
          },
          error instanceof AppError ? error.status : 500,
        );
      } finally {
        cancellation.abort();
        if (previousStage === 'context' || previousStage === 'persistence')
          timings.push({
            stage: previousStage,
            elapsedMs: Date.now() - stageStarted,
          });
        console.info(
          JSON.stringify({
            event: 'chat.timing',
            runId: run.id,
            requestId: input.requestId,
            acknowledgementMs: startedAt - requestStartedAt,
            elapsedMs: Date.now() - startedAt,
            stages: timings,
          }),
        );
      }
    };
    if (!request.headers.get('accept')?.includes('application/x-ndjson'))
      return execute();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        emit = (event) => {
          if (open) {
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            } catch {
              open = false;
            }
          }
        };
        emit({
          type: 'accepted',
          runId: run.id,
          requestId: input.requestId,
          userMessageId: run.userMessageId,
          status: 'working',
          messageSaved: true,
          leaseExpiresAt: run.leaseExpiresAt,
        });
        try {
          const response = await execute();
          const receipt = (await response.json()) as { status: string };
          emit({
            ...receipt,
            type: receipt.status === 'working' ? 'accepted' : receipt.status,
          });
        } finally {
          if (open) {
            try {
              controller.close();
            } catch {
              /* client disconnected */
            }
          }
        }
      },
      cancel() {
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        ...noStore,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    });
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
          .createSignedUrl(
            file.object_path,
            60,
            url.searchParams.get('preview') === '1'
              ? undefined
              : { download: file.filename },
          ),
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
    await disconnectIntegration(input.workspaceId, 'google_calendar', user.id);
    return json({ ok: true });
  }
  throw new AppError('NOT_FOUND', 404, 'This endpoint does not exist.');
});
