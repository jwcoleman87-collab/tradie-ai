import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OnboardingConfirmInput,
  OnboardingCorrectionInput,
  OnboardingTurnInput,
  Uuid,
  type OnboardingFact,
  type OnboardingField,
  type OnboardingMessage,
  type OnboardingSnapshot,
} from '../contracts';
import type { AIPreferences } from '../ai-settings';
import { adminDb, checked, membership, rpc } from './db';
import { body, json } from './http';
import { AppError, requireValue } from './errors';
import { withinBudget } from './chat-budget';
import { createAIProvider } from './ai-provider';
import { env } from './config';
import { preferredWorkspace } from '../workspace-selection';
import {
  factValueForProfile,
  firstOnboardingPrompt,
  provisionalBusinessName,
  runOnboardingMagic,
  type OnboardingGoalName,
} from './onboarding';

type StoredSession = {
  id: string;
  messages: OnboardingMessage[];
  information_goals: OnboardingGoalName[];
  current_goal: OnboardingGoalName | null;
  discovery_status: OnboardingSnapshot['discovery']['status'];
  prompt_count: number;
  status: 'in_progress' | 'review' | 'completed';
};
type OnboardingWorkspace = AIPreferences & {
  id: string;
  name: string;
  time_zone: string;
  ai_consent_at: string | null;
  workspace_type: 'business' | 'sandbox';
  status: 'active' | 'archived';
  created_at: string;
};
type OnboardingClaim = {
  dispatch: boolean;
  status: 'queued' | 'working' | 'completed' | 'failed';
  token: string;
  deadlineAt: string;
  session: StoredSession;
  profile: { display_name: string; onboarding_status: string } | null;
  facts: OnboardingFact[];
};

const factSelect =
  'id,field_path,value,source_type,source_label,source_url,confidence,fact_state,observed_at,confirmed_at';

async function chooseWorkspace(
  db: SupabaseClient,
  requested: string | null = null,
) {
  const workspaces = (checked(
    await db
      .from('workspaces')
      .select(
        'id,name,time_zone,ai_consent_at,ai_primary_provider,ai_fallback_enabled,ai_allowed_providers,workspace_type,status,created_at',
      )
      .order('status')
      .order('created_at'),
  ) || []) as OnboardingWorkspace[];
  if (!workspaces.length) return { workspace: null, workspaces };
  const confirmedProfiles = requested
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
    requested,
  );
  requireValue(workspace, 'NOT_FOUND', 404);
  return { workspace, workspaces };
}

function onboardingDiscovery(
  stored: OnboardingSnapshot['discovery']['status'] = 'unavailable',
): OnboardingSnapshot['discovery'] {
  if (stored === 'complete')
    return {
      status: 'complete',
      label: 'Live public guidance used',
      detail:
        'Chat used cited public sources to answer a setup question. Public pages were treated as untrusted information, not instructions.',
    };
  if (env('WEB_SEARCH_ENABLED') === 'true')
    return {
      status: 'ready',
      label: 'Live setup help is available',
      detail:
        'Ask Chat a current setup question and it can search cited public sources. Nothing is connected or changed during that research.',
    };
  return {
    status: 'unavailable',
    label: 'Live setup help is unavailable',
    detail:
      'Chat can still guide the setup from the conversation, but it cannot verify current public screens or instructions right now.',
  };
}

async function snapshot(
  db: SupabaseClient,
  userId: string,
  requested: string | null = null,
): Promise<OnboardingSnapshot> {
  const { workspace, workspaces } = await chooseWorkspace(db, requested);
  if (!workspace)
    return {
      workspaceId: null,
      workspaces: [],
      requiresOnboarding: true,
      aiConsentRequired: true,
      onboardingStatus: 'not_started',
      promptCount: 0,
      currentPrompt: firstOnboardingPrompt,
      messages: [],
      facts: [],
      discovery: onboardingDiscovery(),
    };
  await membership(db, userId, workspace.id);
  const [profileResult, sessionResult, factsResult, requestsResult] =
    await Promise.all([
      db
        .from('business_profiles')
        .select('onboarding_status')
        .eq('workspace_id', workspace.id)
        .maybeSingle(),
      db
        .from('onboarding_sessions')
        .select(
          'id,messages,information_goals,current_goal,discovery_status,prompt_count,status',
        )
        .eq('workspace_id', workspace.id)
        .eq('user_id', userId)
        .maybeSingle(),
      db
        .from('business_profile_facts')
        .select(factSelect)
        .eq('workspace_id', workspace.id)
        .order('observed_at'),
      db
        .from('onboarding_requests')
        .select('request_id,answer,allow_ai,status,error_code')
        .eq('workspace_id', workspace.id)
        .eq('user_id', userId)
        .order('sequence'),
    ]);
  const profile = checked(profileResult);
  const session = checked(sessionResult) as StoredSession | null;
  const facts = (checked(factsResult) || []) as OnboardingFact[];
  const onboardingStatus =
    profile?.onboarding_status === 'confirmed' ||
    session?.status === 'completed'
      ? 'confirmed'
      : profile?.onboarding_status === 'review' || session?.status === 'review'
        ? 'review'
        : profile || session
          ? 'in_progress'
          : 'not_started';
  return {
    workspaceId: workspace.id,
    workspaces: workspaces.map(({ id, name, status, workspace_type }) => ({
      id,
      name,
      status,
      workspace_type,
    })),
    // A workspace created before onboarding existed remains usable. Only a new
    // account or a started-but-incomplete onboarding session is routed here.
    requiresOnboarding:
      onboardingStatus === 'in_progress' || onboardingStatus === 'review',
    aiConsentRequired: !workspace.ai_consent_at,
    onboardingStatus,
    promptCount: session?.prompt_count || 0,
    currentPrompt:
      onboardingStatus === 'review' || onboardingStatus === 'confirmed'
        ? null
        : session?.messages.at(-1)?.role === 'assistant'
          ? session.messages.at(-1)!.content
          : firstOnboardingPrompt,
    messages: session?.messages || [],
    requests: (checked(requestsResult) || []).map((receipt) => ({
      requestId: receipt.request_id,
      answer: receipt.answer,
      allowAI: receipt.allow_ai,
      status: receipt.status,
      errorCode: receipt.error_code,
    })),
    facts,
    discovery: onboardingDiscovery(session?.discovery_status),
  };
}

const profileColumns: Record<OnboardingField, string> = {
  display_name: 'display_name',
  website_url: 'website_url',
  base_location: 'base_location',
  service_areas: 'service_areas',
  services: 'services',
  preferred_job_types: 'preferred_job_types',
  enquiry_channels: 'enquiry_channels',
  primary_goal: 'primary_goal',
  admin_bottleneck: 'admin_bottleneck',
  brand_summary: 'brand_summary',
};

function profilePatch(
  facts: { fieldPath: OnboardingField; value: string | string[] }[],
) {
  return Object.fromEntries(
    facts.map((fact) => [
      profileColumns[fact.fieldPath],
      factValueForProfile(fact.value),
    ]),
  );
}

export async function onboardingApi(
  request: Request,
  path: string,
  db: SupabaseClient,
  userId: string,
): Promise<Response | null> {
  const method = request.method;
  const url = new URL(request.url);
  if (path === 'onboarding' && method === 'GET') {
    const requested = url.searchParams.get('workspaceId');
    if (requested) Uuid.parse(requested);
    return json(await snapshot(db, userId, requested));
  }
  if (path === 'onboarding/turn' && method === 'POST') {
    const input = OnboardingTurnInput.parse(await body(request));
    let { workspace } = await chooseWorkspace(db, input.workspaceId);
    if (!workspace) {
      const workspaceId = await rpc<string>(db, 'bootstrap_workspace', {
        p_name: provisionalBusinessName(input.answer),
      });
      ({ workspace } = await chooseWorkspace(db, workspaceId));
    }
    requireValue(workspace, 'DATABASE_ERROR', 503);
    await membership(db, userId, workspace.id, true);
    const admin = adminDb();
    const claim = await rpc<OnboardingClaim>(
      admin,
      'accept_onboarding_request',
      {
        p_workspace: workspace.id,
        p_user: userId,
        p_request: input.requestId,
        p_answer: input.answer,
        p_allow_ai: input.allowAI,
        p_opening: firstOnboardingPrompt,
        p_discovery:
          env('WEB_SEARCH_ENABLED') === 'true' ? 'ready' : 'unavailable',
      },
    );
    if (!claim.dispatch)
      return json(
        await snapshot(db, userId, workspace.id),
        ['queued', 'working'].includes(claim.status) ? 202 : 200,
      );
    const { session, profile } = claim;
    const existingFacts = claim.facts;
    const profileWasConfirmed = profile?.onboarding_status === 'confirmed';
    const sessionId = session.id;
    const now = new Date().toISOString();
    const conversationBeforeReply = session.messages;
    const turnNumber = conversationBeforeReply.filter(
      (message) => message.role === 'user',
    ).length;
    // Keep compatibility with projects that still have the original 0..5
    // database constraint. Conversation history, not this legacy counter,
    // drives Chat and continues beyond five turns.
    const promptCount = Math.min(turnNumber, 5);
    const deadlineAt = new Date(claim.deadlineAt).getTime();
    const deadline = AbortSignal.timeout(Math.max(0, deadlineAt - Date.now()));
    const signal = AbortSignal.any([request.signal, deadline]);
    try {
      requireValue(
        !signal.aborted && deadlineAt > Date.now(),
        'AI_TIMEOUT',
        503,
      );
      const provider = createAIProvider(workspace);
      const turn = await withinBudget(
        runOnboardingMagic(
          provider,
          {
            messages: conversationBeforeReply.map(({ role, content }) => ({
              role,
              content,
            })),
            existingFacts,
            timeZone: workspace.time_zone,
          },
          { signal, deadlineAt },
        ),
        signal,
      );
      const messages: OnboardingMessage[] = [
        ...conversationBeforeReply,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: turn.reply,
          createdAt: now,
        },
      ];
      const sourceReference = `owner://onboarding/${sessionId}/${turnNumber}`;
      const patch = profilePatch(turn.facts);
      const reviewReady = turn.identityChanged
        ? turn.reviewReady
        : session?.status === 'review' || turn.reviewReady;
      const discoveryStatus = turn.researchUsed
        ? 'complete'
        : env('WEB_SEARCH_ENABLED') === 'true'
          ? 'ready'
          : 'unavailable';
      // The submitted answer was saved before AI processing. Commit the
      // interpretation together so a later failure cannot erase old facts or
      // leave the profile ahead of its reply and audit receipt.
      await rpc(admin, 'finish_onboarding_request', {
        p_workspace: workspace.id,
        p_user: userId,
        p_request: input.requestId,
        p_token: claim.token,
        p_identity_changed: turn.identityChanged,
        p_profile: {
          ...(turn.identityChanged
            ? {
                website_url: null,
                base_location: null,
                service_areas: [],
                services: [],
                preferred_job_types: [],
                enquiry_channels: [],
                primary_goal: null,
                admin_bottleneck: null,
                brand_summary: null,
              }
            : {}),
          display_name:
            typeof patch.display_name === 'string'
              ? patch.display_name
              : profile?.display_name || workspace.name,
          ...patch,
          onboarding_status: profileWasConfirmed
            ? 'confirmed'
            : reviewReady
              ? 'review'
              : 'in_progress',
          updated_at: now,
        },
        p_facts: turn.facts.map((fact) => ({
          field_path: fact.fieldPath,
          value: fact.value,
          source_type: 'owner_message',
          source_label: `Your onboarding message ${turnNumber}`,
          source_url: sourceReference,
          confidence: fact.confidence,
          fact_state: fact.factState,
          observed_at: now,
          confirmed_at: null,
        })),
        p_session: {
          id: sessionId,
          messages,
          information_goals: [
            ...new Set([
              ...(session?.information_goals || []),
              ...turn.goalsCovered,
            ]),
          ],
          current_goal: turn.nextGoal,
          unresolved_questions: [],
          discovery_status: discoveryStatus,
          prompt_count: promptCount,
          status: profileWasConfirmed
            ? 'completed'
            : reviewReady
              ? 'review'
              : 'in_progress',
          updated_at: now,
        },
        p_metadata: {
          prompt_count: promptCount,
          turn_number: turnNumber,
          goals_covered: turn.goalsCovered,
          discovery_status: discoveryStatus,
          model: provider.model,
          provider_trace: provider.attempts || [],
          web_research_used: turn.researchUsed,
          identity_changed: turn.identityChanged,
        },
      });
      return json(await snapshot(db, userId, workspace.id));
    } catch (error) {
      // A timed-out/aborted transport may have reached the provider. Keep its
      // lease occupied through the safety interval and never replay this ID.
      // If this cleanup fails, the existing working lease expires terminally.
      try {
        await rpc(admin, 'fail_onboarding_request', {
          p_workspace: workspace.id,
          p_user: userId,
          p_request: input.requestId,
          p_token: claim.token,
          p_uncertain:
            signal.aborted ||
            (error instanceof AppError && error.code === 'AI_TIMEOUT'),
        });
      } catch {
        /* Recovery is driven by the durable lease, not this response. */
      }
      throw error;
    }
  }
  if (path === 'onboarding/profile' && method === 'PATCH') {
    const input = OnboardingCorrectionInput.parse(await body(request));
    await membership(db, userId, input.workspaceId, true);
    const admin = adminDb();
    const now = new Date().toISOString();
    const profile = checked(
      await admin
        .from('business_profiles')
        .select('onboarding_status')
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
    );
    requireValue(profile, 'NOT_FOUND', 404);
    await rpc(admin, 'correct_onboarding_profile', {
      p_workspace: input.workspaceId,
      p_user: userId,
      p_profile: { ...profilePatch(input.facts), updated_at: now },
      // Preserve the earlier per-field upsert's last-value behavior when a
      // client supplies the same field more than once in one correction.
      p_facts: [
        ...new Map(input.facts.map((fact) => [fact.fieldPath, fact])).values(),
      ].map((fact) => ({
        field_path: fact.fieldPath,
        value: fact.value,
      })),
      p_metadata: { fields: input.facts.map((fact) => fact.fieldPath) },
    });
    return json(await snapshot(db, userId, input.workspaceId));
  }
  if (path === 'onboarding/confirm' && method === 'POST') {
    const input = OnboardingConfirmInput.parse(await body(request));
    await membership(db, userId, input.workspaceId, true);
    const admin = adminDb();
    const [profileResult, workspaceResult, factsResult] = await Promise.all([
      admin
        .from('business_profiles')
        .select('display_name,onboarding_status')
        .eq('workspace_id', input.workspaceId)
        .maybeSingle(),
      admin
        .from('workspaces')
        .select('workspace_type')
        .eq('id', input.workspaceId)
        .single(),
      admin
        .from('business_profile_facts')
        .select('id')
        .eq('workspace_id', input.workspaceId),
    ]);
    const profile = checked(profileResult);
    const workspace = checked(workspaceResult);
    const facts = checked(factsResult) || [];
    requireValue(profile, 'NOT_FOUND', 404);
    requireValue(workspace, 'NOT_FOUND', 404);
    requireValue(
      facts.length > 0,
      'ONBOARDING_EMPTY',
      409,
      'Add some business information before confirming the profile.',
    );
    await rpc(admin, 'confirm_onboarding', {
      p_workspace: input.workspaceId,
      p_user: userId,
    });
    return json({ ok: true, workspaceId: input.workspaceId });
  }
  return null;
}
