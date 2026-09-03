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
import { requireValue } from './errors';
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
  const [profileResult, sessionResult, factsResult] = await Promise.all([
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
    const [sessionResult, profileResult, factsResult] = await Promise.all([
      admin
        .from('onboarding_sessions')
        .select(
          'id,messages,information_goals,current_goal,discovery_status,prompt_count,status',
        )
        .eq('workspace_id', workspace.id)
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('business_profiles')
        .select('display_name,onboarding_status')
        .eq('workspace_id', workspace.id)
        .maybeSingle(),
      admin
        .from('business_profile_facts')
        .select(factSelect)
        .eq('workspace_id', workspace.id),
    ]);
    const session = checked(sessionResult) as StoredSession | null;
    const profile = checked(profileResult);
    const existingFacts = (checked(factsResult) || []) as OnboardingFact[];
    requireValue(
      profile?.onboarding_status !== 'confirmed',
      'ONBOARDING_COMPLETE',
      409,
      'This business profile is already confirmed.',
    );
    requireValue(
      (session?.messages || []).filter((message) => message.role === 'user')
        .length < 200,
      'ONBOARDING_REVIEW_REQUIRED',
      409,
      'This setup conversation is full. Review the profile before continuing.',
    );
    if (!workspace.ai_consent_at) {
      requireValue(
        input.allowAI,
        'AI_CONSENT_REQUIRED',
        403,
        'Allow Chat to process your setup answers before continuing.',
      );
      const consentedAt = new Date().toISOString();
      checked(
        await admin
          .from('workspaces')
          .update({ ai_consent_at: consentedAt })
          .eq('id', workspace.id),
      );
      workspace.ai_consent_at = consentedAt;
    }
    await rpc(admin, 'consume_rate', {
      p_workspace: workspace.id,
      p_user: userId,
      p_operation: 'onboarding',
      p_limit: 10,
    });
    const sessionId = session?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const conversationBeforeReply: OnboardingMessage[] = [
      ...(session?.messages?.length
        ? session.messages
        : [
            {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: firstOnboardingPrompt,
              createdAt: now,
            },
          ]),
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: input.answer,
        createdAt: now,
      },
    ];
    const provider = createAIProvider(workspace);
    const turn = await runOnboardingMagic(provider, {
      messages: conversationBeforeReply.map(({ role, content }) => ({
        role,
        content,
      })),
      existingFacts,
      timeZone: workspace.time_zone,
    });
    const messages: OnboardingMessage[] = [
      ...conversationBeforeReply,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: turn.reply,
        createdAt: now,
      },
    ];
    const turnNumber = conversationBeforeReply.filter(
      (message) => message.role === 'user',
    ).length;
    // Keep compatibility with projects that still have the original 0..5
    // database constraint. Conversation history, not this legacy counter,
    // drives Chat and continues beyond five turns.
    const promptCount = Math.min(turnNumber, 5);
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
    if (turn.identityChanged)
      checked(
        await admin
          .from('business_profile_facts')
          .delete()
          .eq('workspace_id', workspace.id),
      );
    checked(
      await admin.from('business_profiles').upsert(
        {
          workspace_id: workspace.id,
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
          onboarding_status: reviewReady ? 'review' : 'in_progress',
          updated_at: now,
        },
        { onConflict: 'workspace_id', ignoreDuplicates: false },
      ),
    );
    for (const fact of turn.facts)
      checked(
        await admin.from('business_profile_facts').upsert(
          {
            workspace_id: workspace.id,
            field_path: fact.fieldPath,
            value: fact.value,
            source_type: 'owner_message',
            source_label: `Your onboarding message ${turnNumber}`,
            source_url: sourceReference,
            confidence: fact.confidence,
            fact_state: fact.factState,
            observed_at: now,
            confirmed_at: null,
          },
          { onConflict: 'workspace_id,field_path', ignoreDuplicates: false },
        ),
      );
    checked(
      await admin.from('onboarding_sessions').upsert(
        {
          id: sessionId,
          user_id: userId,
          workspace_id: workspace.id,
          messages,
          information_goals: turn.goalsCovered,
          current_goal: turn.nextGoal,
          unresolved_questions: [],
          discovery_status: discoveryStatus,
          prompt_count: promptCount,
          status: reviewReady ? 'review' : 'in_progress',
          updated_at: now,
        },
        { onConflict: 'workspace_id', ignoreDuplicates: false },
      ),
    );
    checked(
      await admin.from('audit_logs').insert({
        workspace_id: workspace.id,
        actor_id: userId,
        event: 'onboarding.turn_saved',
        entity_id: sessionId,
        metadata: {
          prompt_count: promptCount,
          turn_number: turnNumber,
          goals_covered: turn.goalsCovered,
          discovery_status: discoveryStatus,
          model: provider.model,
          provider_trace: provider.attempts || [],
          web_research_used: turn.researchUsed,
          identity_changed: turn.identityChanged,
        },
      }),
    );
    return json(await snapshot(db, userId, workspace.id));
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
    requireValue(
      profile.onboarding_status !== 'confirmed',
      'ONBOARDING_COMPLETE',
      409,
      'This business profile is already confirmed.',
    );
    checked(
      await admin
        .from('business_profiles')
        .update({ ...profilePatch(input.facts), updated_at: now })
        .eq('workspace_id', input.workspaceId),
    );
    for (const fact of input.facts)
      checked(
        await admin.from('business_profile_facts').upsert(
          {
            workspace_id: input.workspaceId,
            field_path: fact.fieldPath,
            value: fact.value,
            source_type: 'owner_correction',
            source_label: 'Your profile correction',
            source_url: null,
            confidence: 'high',
            fact_state: 'owner_supplied',
            observed_at: now,
            confirmed_at: null,
          },
          { onConflict: 'workspace_id,field_path', ignoreDuplicates: false },
        ),
      );
    checked(
      await admin.from('audit_logs').insert({
        workspace_id: input.workspaceId,
        actor_id: userId,
        event: 'onboarding.profile_corrected',
        entity_id: input.workspaceId,
        metadata: { fields: input.facts.map((fact) => fact.fieldPath) },
      }),
    );
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
    const now = new Date().toISOString();
    checked(
      await admin
        .from('business_profiles')
        .update({
          onboarding_status: 'confirmed',
          confirmed_at: now,
          updated_at: now,
        })
        .eq('workspace_id', input.workspaceId),
    );
    checked(
      await admin
        .from('business_profile_facts')
        .update({ fact_state: 'confirmed', confirmed_at: now })
        .eq('workspace_id', input.workspaceId),
    );
    checked(
      await admin
        .from('onboarding_sessions')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('workspace_id', input.workspaceId)
        .eq('user_id', userId),
    );
    await rpc(admin, 'update_workspace', {
      p_workspace: input.workspaceId,
      p_user: userId,
      p_name: profile.display_name,
      p_workspace_type: workspace.workspace_type,
    });
    checked(
      await admin.from('audit_logs').insert({
        workspace_id: input.workspaceId,
        actor_id: userId,
        event: 'onboarding.completed',
        entity_id: input.workspaceId,
        metadata: { fact_count: facts.length },
      }),
    );
    return json({ ok: true, workspaceId: input.workspaceId });
  }
  return null;
}
