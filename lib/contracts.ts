import { z } from 'zod';
import type { AIPreferences, AIProviderName } from './ai-settings';

export const agents = [
  'finance',
  'marketing',
  'social',
  'maintenance',
  'website',
] as const;
export const Agent = z.enum(agents);
export type AgentName = z.infer<typeof Agent>;
export const Uuid = z.uuid();
export const RecordKind = z.enum([
  'asset',
  'maintenance',
  'customer',
  'job',
  'invoice',
  'expense',
  'campaign',
  'website',
  'social',
  'note',
]);
const Title = z.string().trim().min(1).max(160);
const Body = z.string().trim().min(1).max(12000);
const ZonedDate = z.iso.datetime({ offset: true });
export const CalendarPayload = z
  .object({
    summary: Title,
    description: z.string().max(4000),
    start: ZonedDate,
    end: ZonedDate,
    timeZone: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      Date.parse(p.end) <= Date.parse(p.start) ||
      Date.parse(p.end) - Date.parse(p.start) > 7 * 86400000
    )
      ctx.addIssue({
        code: 'custom',
        message: 'The booking must end after it starts, within seven days.',
      });
    try {
      new Intl.DateTimeFormat('en', { timeZone: p.timeZone });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid time zone.' });
    }
  });
export const RecordPayload = z
  .object({ kind: RecordKind, title: Title, body: Body })
  .strict();
export const FacebookPayload = z
  .object({
    pageId: z.string().regex(/^\d{1,30}$/),
    message: z.string().trim().min(1).max(5000),
    imageFileId: Uuid.nullable(),
    link: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.imageFileId && p.link)
      ctx.addIssue({
        code: 'custom',
        message: 'A Facebook photo post cannot also use a link preview.',
      });
    if (p.link && (new URL(p.link).username || new URL(p.link).password))
      ctx.addIssue({
        code: 'custom',
        message: 'Links cannot contain credentials.',
      });
  });
export const Proposal = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('facebook.publish'),
      summary: Title,
      agent: z.literal('social'),
      payload: FacebookPayload,
    })
    .strict(),
  z
    .object({
      type: z.literal('calendar.create'),
      summary: Title,
      agent: Agent,
      payload: CalendarPayload,
    })
    .strict(),
  z
    .object({
      type: z.literal('draft.save'),
      summary: Title,
      agent: Agent,
      payload: RecordPayload,
    })
    .strict(),
  z
    .object({
      type: z.literal('record.create'),
      summary: Title,
      agent: Agent,
      payload: RecordPayload,
    })
    .strict(),
]);
export type ProposalInput = z.infer<typeof Proposal>;
export const ChatInput = z
  .object({
    workspaceId: Uuid,
    conversationId: Uuid,
    requestId: Uuid,
    text: Body,
    attachmentIds: z.array(Uuid).max(4).default([]),
  })
  .strict();
export const RouteOutput = z
  .object({
    agents: z.array(Agent).min(1).max(5),
    reason: z.string().max(500),
    webSearch: z.boolean(),
    searchQuery: z.string().trim().min(3).max(300).nullable(),
  })
  .strict();
export const AgentOutput = z
  .object({
    reply: Body,
    proposals: z.array(Proposal).max(5),
    escalation: z.enum([
      'none',
      'missing_information',
      'integration_error',
      'safety_review',
    ]),
  })
  .strict();
export const CaseInput = z
  .object({
    workspaceId: Uuid,
    conversationId: Uuid.nullable(),
    agent: Agent,
    category: z.enum([
      'missing_information',
      'integration_error',
      'safety_review',
      'general',
    ]),
    problem: z.string().min(1).max(2000),
    shareWithSupport: z.boolean(),
  })
  .strict();

export const OnboardingFieldPath = z.enum([
  'display_name',
  'website_url',
  'base_location',
  'service_areas',
  'services',
  'preferred_job_types',
  'enquiry_channels',
  'primary_goal',
  'admin_bottleneck',
  'brand_summary',
]);
export type OnboardingField = z.infer<typeof OnboardingFieldPath>;
export const OnboardingFactValue = z.union([
  z.string().trim().min(1).max(1000),
  z.array(z.string().trim().min(1).max(240)).min(1).max(20),
]);
export const OnboardingTurnInput = z
  .object({
    workspaceId: Uuid.nullable().default(null),
    answer: z.string().trim().min(2).max(4000),
    allowAI: z.boolean().default(false),
  })
  .strict();
export const OnboardingCorrectionInput = z
  .object({
    workspaceId: Uuid,
    facts: z
      .array(
        z
          .object({
            fieldPath: OnboardingFieldPath,
            value: OnboardingFactValue,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const OnboardingConfirmInput = z.object({ workspaceId: Uuid }).strict();

export type OnboardingFact = {
  id: string;
  field_path: OnboardingField;
  value: string | string[];
  source_type: 'owner_message' | 'owner_correction' | 'public_source';
  source_label: string;
  source_url: string | null;
  confidence: 'high' | 'medium' | 'low';
  fact_state:
    | 'discovered'
    | 'owner_supplied'
    | 'inferred'
    | 'confirmed'
    | 'needs_confirmation';
  observed_at: string;
  confirmed_at: string | null;
};
export type OnboardingMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: string;
};
export type OnboardingSnapshot = {
  workspaceId: string | null;
  workspaces: {
    id: string;
    name: string;
    status: 'active' | 'archived';
    workspace_type: 'business' | 'sandbox';
  }[];
  requiresOnboarding: boolean;
  aiConsentRequired: boolean;
  onboardingStatus: 'not_started' | 'in_progress' | 'review' | 'confirmed';
  promptCount: number;
  currentPrompt: string | null;
  messages: OnboardingMessage[];
  facts: OnboardingFact[];
  discovery: {
    status: 'unavailable' | 'ready' | 'complete' | 'failed';
    label: string;
    detail: string;
  };
};
export type ActionStatus =
  | 'waiting_approval'
  | 'approved'
  | 'denied'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';
export type Action = {
  id: string;
  workspace_id: string;
  conversation_id: string;
  connection_id: string | null;
  agent: AgentName;
  action_type: ProposalInput['type'];
  summary: string;
  payload: Record<string, unknown>;
  status: ActionStatus;
  expires_at: string;
  error_code: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
};
export type ChatMessage = {
  id: string;
  run_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  attachment_ids: string[];
};
export type WorkspaceData = AIPreferences & {
  id: string;
  name: string;
  time_zone: string;
  ai_consent_at: string | null;
  workspace_type: 'business' | 'sandbox';
  status: 'active' | 'archived';
  archived_at: string | null;
};
export type Conversation = {
  id: string;
  title: string;
  status: 'active' | 'archived';
  archived_at: string | null;
  created_at: string;
};
export type Upload = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
};
export type Escalation = {
  id: string;
  case_id: string;
  problem: string;
  solution: string | null;
  outcome: string | null;
  status: string;
  shared_with_support: boolean;
};
export type BusinessRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  status: 'active' | 'archived';
  archived_at: string | null;
  retention_class: string;
  legal_hold: boolean;
  created_at: string;
};
export type Snapshot = {
  workspaces: WorkspaceData[];
  workspace: WorkspaceData;
  role: string;
  conversations: Conversation[];
  conversationId: string | null;
  messages: ChatMessage[];
  actions: Action[];
  uploads: Upload[];
  cases: Escalation[];
  records: BusinessRecord[];
  audit: {
    id: number;
    event: string;
    created_at: string;
    entity_id?: string;
    errorCode?: string;
  }[];
  runs: {
    id: string;
    agents: AgentName[];
    status: string;
    model: string | null;
    error_code: string | null;
    created_at: string;
    finished_at: string | null;
    provider_trace: {
      provider: AIProviderName;
      model: string;
      status: string;
      errorCode?: string;
      elapsedMs?: number;
      httpStatus?: number;
      providerRequestId?: string;
      clientRequestId?: string;
      step?: 'routing' | 'research' | 'response';
    }[];
  }[];
  calendarConnected: boolean;
  onboardingStatus: 'in_progress' | 'review' | 'confirmed' | null;
};
