import { z } from 'zod';
import { Agent, AgentOutput } from '../../contracts';
import type { ModelDiagnostic } from '../../ai-diagnostics';

export const Consequence = z.enum([
  'read',
  'internal_reversible',
  'prepare',
  'external_consequential',
  'restricted',
]);
export type ConsequenceClass = z.infer<typeof Consequence>;
export const ManagerAnswer = AgentOutput.omit({ proposals: true })
  .extend({
    // Support-case creation is not a governed Manager capability. A diagnosis
    // recommendation must not trigger the legacy Chat escalation writer.
    escalation: z.literal('none'),
    attention: z.enum(['contained', 'deferred', 'batched', 'interrupt']),
    shortcut: z
      .enum(['facebook_connection', 'calendar_connection', 'actions'])
      .nullable(),
  })
  .strict();
export type ManagerToolCall = { id: string; name: string; arguments: unknown };
export type ToolDefinition = {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  workspaceScope: 'current';
  consequence: ConsequenceClass;
  readOnly: boolean;
  reversible: boolean;
  authority: 'member' | 'owner';
  provenance: 'observed' | 'inferred' | 'verified';
};
export type ToolResult = {
  callId: string;
  name: string;
  ok: boolean;
  evidence?: unknown;
  errorCode?: string;
};
export type ManagerUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
export type ManagerAttempt = Partial<ModelDiagnostic> & {
  provider: string;
  model: string;
  adapter: string;
  step: 'response';
  status: 'completed' | 'failed';
  elapsedMs: number;
  errorCode?: string;
};
export type ManagerTurnInput = {
  instructions: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  context: Record<string, unknown>;
  tools: ToolDefinition[];
  results: ToolResult[];
  attachments?: (
    | { kind: 'text'; text: string }
    | { kind: 'image'; mediaType: string; base64: string }
  )[];
  signal: AbortSignal;
  maxOutputTokens: number;
};
export type ManagerTurnResult =
  | { kind: 'tools'; calls: ManagerToolCall[] }
  | { kind: 'final'; answer: z.infer<typeof ManagerAnswer> };
export interface ManagerModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly usage: ManagerUsage[];
  readonly attempts: ManagerAttempt[];
  runTurn(input: ManagerTurnInput): Promise<ManagerTurnResult>;
}
export const ToolTrace = z
  .object({
    name: z.string().max(80),
    consequence: Consequence.nullable(),
    status: z.enum(['completed', 'denied', 'failed']),
    approvalRequired: z.boolean(),
    elapsedMs: z.number().nonnegative(),
    errorCode: z.string().max(80).optional(),
  })
  .strict();
export type ManagerToolTrace = z.infer<typeof ToolTrace>;
export const SkillSelection = z
  .object({ agents: z.array(Agent).min(1).max(5) })
  .strict();
