import { z } from 'zod';

export const DiagnosisInput = z
  .object({
    workspaceId: z.uuid(),
    kind: z.enum(['run', 'action']),
    targetId: z.uuid(),
  })
  .strict();
export type DiagnosisTarget = z.infer<typeof DiagnosisInput>;
export const DiagnosisReport = z
  .object({
    likelyCause: z.string().min(1).max(1200),
    confidence: z.enum(['low', 'medium', 'high']),
    recommendations: z
      .array(
        z
          .object({
            owner: z.enum(['workspace_owner', 'app_operator']),
            step: z.string().min(1).max(700),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    missingEvidence: z.array(z.string().min(1).max(500)).max(4),
  })
  .strict();
export type DiagnosisResult = {
  requestId: string;
  observedAt: string;
  evidence: Record<string, unknown>;
  report: z.infer<typeof DiagnosisReport> | null;
  unavailableCode?: string;
  model?: string;
  usage: { inputTokens: number; outputTokens: number }[];
};
