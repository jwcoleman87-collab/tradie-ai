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
import { adminDb, checked, membership, rpc } from './db';
import { body, json } from './http';
import { requireValue } from './errors';
import { businessDiscovery } from './discovery';
import {
  buildOnboardingTurn,
  factValueForProfile,
  firstOnboardingPrompt,
  provisionalBusinessName,
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

const factSelect =
  'id,field_path,value,source_type,source_label,source_url,confidence,fact_state,observed_at,confirmed_at';

async function chooseWorkspace(
  db: SupabaseClient,
  requested: string | null = null,
) {
  const workspaces =
    checked(
      await db
        .from('workspaces')
        .select('id,name,workspace_type,status,created_at')
        .order('status')
        .order('created_at'),
    ) || [];
  if (!workspaces.length) return null;
  const workspace = requested
    ? workspaces.find((candidate) => candidate.id === requested)
    : workspaces.find((candidate) => candidate.status === 'active') ||
      workspaces[0];
  requireValue(workspace, 'NOT_FOUND', 404);
  return workspace;
}

async function snapshot(
  db: SupabaseClient,
  userId: string,
  requested: string | null = null,
): Promise<OnboardingSnapshot> {
  const workspace = await chooseWorkspace(db, requested);
  if (!workspace)
    return {
      workspaceId: null,
      requiresOnboarding: true,
      onboardingStatus: 'not_started',
      promptCount: 0,
      currentPrompt: firstOnboardingPrompt,
      messages: [],
      facts: [],
      discovery: businessDiscovery.status(),
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
    // A workspace created before onboarding existed remains usable. Only a new
    // account or a started-but-incomplete onboarding session is routed here.
    requiresOnboarding:
      onboardingStatus === 'in_progress' || onboardingStatus === 'review',
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
    discovery: businessDiscovery.status(),
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
    let workspace = await chooseWorkspace(db, input.workspaceId);
    if (!workspace) {
      const workspaceId = await rpc<string>(db, 'bootstrap_workspace', {
        p_name: provisionalBusinessName(input.answer),
      });
      workspace = await chooseWorkspace(db, workspaceId);
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
        .select('onboarding_status')
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
      (session?.prompt_count || 0) < 5,
      'ONBOARDING_REVIEW_REQUIRED',
      409,
      'Review the profile before adding more information.',
    );
    const sessionId = session?.id || crypto.randomUUID();
    const currentGoal = session?.current_goal || 'identity_anchor';
    const turn = buildOnboardingTurn({
      answer: input.answer,
      currentGoal,
      goalsCovered: session?.information_goals || [],
      existingFacts,
    });
    const now = new Date().toISOString();
    const sourceReference = `owner://onboarding/${sessionId}/${(session?.prompt_count || 0) + 1}`;
    const messages: OnboardingMessage[] = [
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
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: turn.reply,
        createdAt: now,
      },
    ];
    const promptCount = (session?.prompt_count || 0) + 1;
    checked(
      await admin.from('business_profiles').upsert(
        {
          workspace_id: workspace.id,
          display_name:
            typeof profilePatch(turn.facts).display_name === 'string'
              ? profilePatch(turn.facts).display_name
              : workspace.name,
          ...profilePatch(turn.facts),
          onboarding_status: turn.reviewReady ? 'review' : 'in_progress',
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
            source_label: `Your onboarding answer ${promptCount}`,
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
          discovery_status: businessDiscovery.status().status,
          prompt_count: promptCount,
          status: turn.reviewReady ? 'review' : 'in_progress',
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
          goals_covered: turn.goalsCovered,
          discovery_status: businessDiscovery.status().status,
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
