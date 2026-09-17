import { AppError } from '../errors';
import { callSignal, withinBudget } from '../chat-budget';
import {
  ManagerAnswer,
  type ManagerModelAdapter,
  type ManagerEconomy,
  type ManagerToolTrace,
  type ManagerTurnInput,
  type ManagerUsage,
  type ToolDefinition,
  type ToolResult,
} from './contracts';

export interface ManagerTools {
  definitions: ToolDefinition[];
  authorize?(signal: AbortSignal): Promise<void>;
  invoke(name: string, input: unknown, signal: AbortSignal): Promise<unknown>;
}
export const MANAGER_LIMITS = {
  turns: 6,
  tools: 12,
  deadlineMs: 85_000,
  toolMs: 15_000,
  outputChars: 24_000,
  inputChars: 16_000,
  outputTokens: 3500,
  // Model-token budget for the whole run. Checked after every model call, so
  // the run stops before spending another call once the budget is spent.
  inputTokens: 60_000,
  totalTokens: 80_000,
} as const;

export function sumUsage(usage: ManagerUsage[]) {
  return usage.reduce(
    (acc, row) => ({
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      cachedInputTokens: acc.cachedInputTokens + (row.cachedInputTokens || 0),
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
  );
}

export function authorityDecision(tool: ToolDefinition, role: string) {
  if (tool.authority === 'owner' && role !== 'owner') return 'deny';
  if (tool.consequence === 'restricted') return 'deny';
  if (tool.consequence === 'external_consequential') return 'approval';
  return 'allow';
}
export class ManagerRuntime {
  readonly toolTrace: ManagerToolTrace[] = [];
  readonly results: ToolResult[] = [];
  readonly economy: ManagerEconomy = {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    contextChars: 0,
    evidenceChars: {},
    stopReason: 'error',
  };
  private refreshEconomy() {
    Object.assign(this.economy, sumUsage(this.adapter.usage));
  }
  constructor(
    readonly adapter: ManagerModelAdapter,
    readonly tools: ManagerTools,
  ) {}
  async run(
    input: Omit<ManagerTurnInput, 'tools' | 'results' | 'maxOutputTokens'>,
    limits: Partial<Record<keyof typeof MANAGER_LIMITS, number>> = {},
  ) {
    const budget = { ...MANAGER_LIMITS, ...limits };
    const signal = callSignal({ signal: input.signal }, budget.deadlineMs);
    const seen = new Set<string>();
    let calls = 0;
    this.economy.contextChars =
      input.instructions.length +
      input.messages.reduce((n, m) => n + m.content.length, 0) +
      JSON.stringify(input.context).length;
    try {
      for (let turn = 0; turn < budget.turns; turn++) {
        if (this.tools.authorize)
          await withinBudget(this.tools.authorize(signal), signal);
        // Token-aware continuation: a model call is the expensive step. Never
        // start one after the run's token budget is spent.
        this.refreshEconomy();
        if (
          this.economy.inputTokens >= budget.inputTokens ||
          this.economy.totalTokens >= budget.totalTokens
        )
          throw new AppError('MANAGER_TOKEN_LIMIT', 409);
        this.economy.modelCalls++;
        const next = await withinBudget(
          this.adapter.runTurn({
            ...input,
            signal,
            tools: this.tools.definitions,
            results: this.results,
            maxOutputTokens: budget.outputTokens,
            context: {
              ...input.context,
              runtimeIdentity: {
                provider: this.adapter.provider,
                model: this.adapter.model,
                adapter: this.adapter.version,
              },
            },
          }),
          signal,
        );
        this.refreshEconomy();
        if (next.kind === 'final') {
          this.economy.stopReason = 'final';
          return { answer: ManagerAnswer.parse(next.answer), partial: false };
        }
        if (!next.calls.length)
          throw new AppError('MANAGER_INVALID_RESPONSE', 502);
        for (const call of next.calls) {
          if (++calls > budget.tools)
            throw new AppError('MANAGER_TOOL_LIMIT', 409);
          this.economy.toolCalls = calls;
          const known = this.tools.definitions.find(
            (tool) => tool.name === call.name,
          );
          const started = Date.now();
          const trace: ManagerToolTrace = {
            name: known?.name || 'undeclared_tool',
            consequence: known?.consequence || null,
            approvalRequired: known?.consequence === 'external_consequential',
            elapsedMs: 0,
            status: 'denied',
          };
          let result: ToolResult;
          try {
            if (!known) throw new AppError('MANAGER_TOOL_UNDECLARED', 403);
            const raw = JSON.stringify(call.arguments);
            if (!raw || raw.length > budget.inputChars)
              throw new AppError('MANAGER_INPUT_TOO_LARGE', 400);
            const parsed = known.input.safeParse(call.arguments);
            if (!parsed.success)
              throw new AppError('MANAGER_INPUT_INVALID', 400);
            const fingerprint = known.name + ':' + JSON.stringify(parsed.data);
            if (seen.has(fingerprint))
              throw new AppError('MANAGER_REPEATED_TOOL', 409);
            seen.add(fingerprint);
            const decision = authorityDecision(
              known,
              String(input.context.role),
            );
            if (decision !== 'allow')
              throw new AppError(
                decision === 'approval'
                  ? 'OWNER_APPROVAL_REQUIRED'
                  : 'MANAGER_AUTHORITY_DENIED',
                403,
              );
            trace.status = 'failed';
            const toolSignal = callSignal(
              { signal },
              known.name === 'diagnosis.run'
                ? 55_000
                : known.name === 'web.research'
                  ? 25_000
                  : budget.toolMs,
            );
            const value = await withinBudget(
              this.tools.invoke(known.name, parsed.data, toolSignal),
              toolSignal,
            );
            const output = known.output.safeParse(value);
            if (!output.success)
              throw new AppError('MANAGER_OUTPUT_INVALID', 502);
            const evidenceChars = JSON.stringify(output.data).length;
            if (evidenceChars > budget.outputChars)
              throw new AppError('MANAGER_OUTPUT_TOO_LARGE', 502);
            this.economy.evidenceChars[known.name] =
              (this.economy.evidenceChars[known.name] || 0) + evidenceChars;
            result = {
              callId: call.id,
              name: known.name,
              ok: true,
              evidence: output.data,
            };
            trace.status = 'completed';
          } catch (error) {
            const code =
              error instanceof AppError && /^[A-Z_]{2,80}$/.test(error.code)
                ? error.code
                : 'MANAGER_TOOL_FAILED';
            trace.errorCode = code;
            result = {
              callId: call.id,
              name: known?.name || 'undeclared_tool',
              ok: false,
              errorCode: code,
            };
          }
          trace.elapsedMs = Date.now() - started;
          this.toolTrace.push(trace);
          this.results.push(result);
        }
      }
      throw new AppError('MANAGER_TURN_LIMIT', 409);
    } catch (error) {
      const code =
        error instanceof AppError && /^[A-Z_]{2,80}$/.test(error.code)
          ? error.code
          : 'MANAGER_FAILED';
      this.refreshEconomy();
      this.economy.stopReason =
        code === 'MANAGER_TOKEN_LIMIT' ||
        code === 'MANAGER_TURN_LIMIT' ||
        code === 'MANAGER_TOOL_LIMIT'
          ? 'budget'
          : 'error';
      return {
        partial: true,
        errorCode: code,
        answer: ManagerAnswer.parse({
          reply: `Workbench stopped before completing this request (${code}). ${this.toolTrace.filter((t) => t.status === 'completed').length} capability checks or preparations completed. Prepared items below remain available for review. No external action was executed.`,
          escalation: 'none',
          attention: 'deferred',
          shortcut: 'actions',
        }),
      };
    }
  }
}
