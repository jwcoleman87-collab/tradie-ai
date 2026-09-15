import { z } from 'zod';
import {
  ManagerAnswer,
  type ManagerAttempt,
  type ManagerModelAdapter,
  type ManagerTurnInput,
  type ManagerTurnResult,
  type ManagerUsage,
} from './contracts';
import { modelFetch } from '../model-fetch';
import {
  boundedModelJson,
  modelHttpError,
  parseModelJson,
  modelTimeout,
} from '../model-http';
import { modelSchema } from '../model-schema';
import { required } from '../config';
import { AppError } from '../errors';
import { callSignal, withinBudget } from '../chat-budget';
import type { ModelDiagnostic } from '../../ai-diagnostics';
import type { AIPreferences, AIProviderName } from '../../ai-settings';
import { managerConfiguration } from './config';

const wireName = (name: string) => name.replaceAll('.', '__');
const callId = z.string().min(1).max(200);
const count = z.number().int().nonnegative();
const openaiOutput = z.object({
  status: z.string(),
  output: z.array(z.object({ type: z.string() }).loose()).max(40),
  usage: z
    .object({ input_tokens: count, output_tokens: count, total_tokens: count })
    .optional(),
});
const anthropicOutput = z.object({
  stop_reason: z.string(),
  content: z.array(z.object({ type: z.string() }).loose()).max(40),
  usage: z
    .object({
      input_tokens: count,
      output_tokens: count,
      cache_creation_input_tokens: count.optional(),
      cache_read_input_tokens: count.optional(),
    })
    .optional(),
});

/** Provider wire state stays here, in memory, only for this request. Never persist
 * raw response items, reasoning, tool arguments or evidence in diagnostics. */
export class ResponsesManagerAdapter implements ManagerModelAdapter {
  readonly provider = 'openai';
  readonly version = 'responses-manager-v1';
  readonly usage: ManagerUsage[] = [];
  readonly attempts: ManagerAttempt[] = [];
  private transcript: unknown[] = [];
  private delivered = 0;
  constructor(readonly model: string) {}
  async runTurn(input: ManagerTurnInput): Promise<ManagerTurnResult> {
    if (!this.transcript.length) {
      this.transcript = [
        ...input.messages,
        {
          role: 'user',
          content: JSON.stringify({
            context: input.context,
            priorCapabilityResults: input.results,
          }),
        },
      ];
      if (input.attachments?.length)
        this.transcript.push({
          role: 'user',
          content: input.attachments.map((item) =>
            item.kind === 'text'
              ? { type: 'input_text', text: item.text }
              : {
                  type: 'input_image',
                  image_url: `data:${item.mediaType};base64,${item.base64}`,
                  detail: 'auto',
                },
          ),
        });
      this.delivered = input.results.length;
    } else {
      this.transcript.push(
        ...input.results.slice(this.delivered).map((result) => ({
          type: 'function_call_output',
          call_id: result.callId,
          output: JSON.stringify(result),
        })),
      );
      this.delivered = input.results.length;
    }
    const diagnostics: ModelDiagnostic[] = [];
    const started = Date.now();
    let errorCode: string | undefined;
    try {
      const signal = callSignal({ signal: input.signal }, modelTimeout());
      const response = await modelFetch(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${required('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            store: false,
            instructions: input.instructions,
            input: this.transcript,
            max_output_tokens: input.maxOutputTokens,
            include: ['reasoning.encrypted_content'],
            parallel_tool_calls: false,
            tools: input.tools.map((tool) => ({
              type: 'function',
              name: wireName(tool.name),
              description: tool.description,
              parameters: modelSchema(tool.input, 'openai'),
              strict: true,
            })),
            text: {
              format: {
                type: 'json_schema',
                name: 'manager_answer',
                strict: true,
                schema: modelSchema(ManagerAnswer, 'openai'),
              },
            },
          }),
          signal,
        },
        diagnostics,
      );
      if (!response.ok) throw await modelHttpError('openai', response);
      const data = openaiOutput.parse(
        await withinBudget(boundedModelJson(response), signal),
      );
      if (data.usage)
        this.usage.push({
          provider: this.provider,
          model: this.model,
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          totalTokens: data.usage.total_tokens,
        });
      if (
        data.output.some(
          (item) =>
            Array.isArray(item.content) &&
            item.content.some((c) => c.type === 'refusal'),
        )
      )
        throw new AppError('AI_REFUSED', 422);
      if (data.status !== 'completed') throw new AppError('AI_INCOMPLETE', 502);
      this.transcript.push(...data.output);
      const calls = data.output
        .filter((item) => item.type === 'function_call')
        .map((item) => {
          const call = z
            .object({
              call_id: callId,
              name: z.string().max(100),
              arguments: z.string().max(16000),
            })
            .parse(item);
          const name =
            input.tools.find((tool) => wireName(tool.name) === call.name)
              ?.name || call.name;
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            throw new AppError('AI_INVALID_RESPONSE', 502);
          }
          return { id: call.call_id, name, arguments: args };
        });
      if (calls.length) return { kind: 'tools', calls };
      const content = data.output.flatMap((item) =>
        Array.isArray(item.content) ? item.content : [],
      );
      return {
        kind: 'final',
        answer: parseModelJson(
          ManagerAnswer,
          content
            .filter((item) => item.type === 'output_text')
            .map((item) => item.text)
            .join(''),
        ),
      };
    } catch (error) {
      errorCode =
        error instanceof AppError ? error.code : 'AI_INVALID_RESPONSE';
      throw new AppError(errorCode, 502);
    } finally {
      this.attempts.push({
        ...diagnostics[0],
        provider: this.provider,
        model: this.model,
        adapter: this.version,
        step: 'response',
        elapsedMs: Date.now() - started,
        status: errorCode ? 'failed' : 'completed',
        ...(errorCode ? { errorCode } : {}),
        maxOutputTokens: input.maxOutputTokens,
      });
    }
  }
}

export class AnthropicManagerAdapter implements ManagerModelAdapter {
  readonly provider = 'anthropic';
  readonly version = 'messages-manager-v1';
  readonly usage: ManagerUsage[] = [];
  readonly attempts: ManagerAttempt[] = [];
  private transcript: unknown[] = [];
  private delivered = 0;
  constructor(readonly model: string) {}
  async runTurn(input: ManagerTurnInput): Promise<ManagerTurnResult> {
    if (!this.transcript.length) {
      this.transcript = [
        {
          role: 'user',
          content: JSON.stringify({
            conversation: input.messages,
            context: input.context,
            priorCapabilityResults: input.results,
          }),
        },
      ];
      if (input.attachments?.length)
        this.transcript.push({
          role: 'user',
          content: input.attachments.map((item) =>
            item.kind === 'text'
              ? { type: 'text', text: item.text }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: item.mediaType,
                    data: item.base64,
                  },
                },
          ),
        });
      this.delivered = input.results.length;
    } else {
      this.transcript.push({
        role: 'user',
        content: input.results
          .slice(this.delivered)
          .map((result) => ({
            type: 'tool_result',
            tool_use_id: result.callId,
            content: JSON.stringify(result),
            is_error: !result.ok,
          })),
      });
      this.delivered = input.results.length;
    }
    const diagnostics: ModelDiagnostic[] = [];
    const started = Date.now();
    let errorCode: string | undefined;
    try {
      const signal = callSignal({ signal: input.signal }, modelTimeout());
      const response = await modelFetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'x-api-key': required('ANTHROPIC_API_KEY'),
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            system: input.instructions,
            messages: this.transcript,
            max_tokens: input.maxOutputTokens,
            tools: input.tools.map((tool) => ({
              name: wireName(tool.name),
              description: tool.description,
              input_schema: modelSchema(tool.input, 'anthropic'),
            })),
            output_config: {
              format: {
                type: 'json_schema',
                schema: modelSchema(ManagerAnswer, 'anthropic'),
              },
            },
          }),
          signal,
        },
        diagnostics,
      );
      if (!response.ok) throw await modelHttpError('anthropic', response);
      const data = anthropicOutput.parse(
        await withinBudget(boundedModelJson(response), signal),
      );
      if (data.usage) {
        const inputTokens =
          data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens || 0) +
          (data.usage.cache_read_input_tokens || 0);
        this.usage.push({
          provider: this.provider,
          model: this.model,
          inputTokens,
          outputTokens: data.usage.output_tokens,
          totalTokens: inputTokens + data.usage.output_tokens,
        });
      }
      if (data.stop_reason === 'refusal') throw new AppError('AI_REFUSED', 422);
      if (!['end_turn', 'tool_use'].includes(data.stop_reason))
        throw new AppError('AI_INCOMPLETE', 502);
      this.transcript.push({ role: 'assistant', content: data.content });
      const calls = data.content
        .filter((item) => item.type === 'tool_use')
        .map((item) => {
          const call = z
            .object({
              id: callId,
              name: z.string().max(100),
              input: z.unknown(),
            })
            .parse(item);
          return {
            id: call.id,
            name:
              input.tools.find((tool) => wireName(tool.name) === call.name)
                ?.name || call.name,
            arguments: call.input,
          };
        });
      if (calls.length) return { kind: 'tools', calls };
      return {
        kind: 'final',
        answer: parseModelJson(
          ManagerAnswer,
          data.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join(''),
        ),
      };
    } catch (error) {
      errorCode =
        error instanceof AppError ? error.code : 'AI_INVALID_RESPONSE';
      throw new AppError(errorCode, 502);
    } finally {
      this.attempts.push({
        ...diagnostics[0],
        provider: this.provider,
        model: this.model,
        adapter: this.version,
        step: 'response',
        elapsedMs: Date.now() - started,
        status: errorCode ? 'failed' : 'completed',
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }
}

const fallbackCodes = new Set([
  'AI_QUOTA_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_TIMEOUT',
  'AI_NETWORK_ERROR',
]);
export class FallbackManagerAdapter implements ManagerModelAdapter {
  private index = 0;
  constructor(private choices: ManagerModelAdapter[]) {
    if (!choices.length || choices.length > 2)
      throw new AppError('SETUP_REQUIRED', 503);
  }
  get provider() {
    return this.choices[this.index].provider;
  }
  get model() {
    return this.choices[this.index].model;
  }
  get version() {
    return this.choices[this.index].version;
  }
  get usage() {
    return this.choices.flatMap((adapter) => adapter.usage);
  }
  get attempts() {
    return this.choices.flatMap((adapter) => adapter.attempts);
  }
  async runTurn(input: ManagerTurnInput): Promise<ManagerTurnResult> {
    const selectedInput = () => ({
      ...input,
      context: {
        ...input.context,
        runtimeIdentity: {
          provider: this.provider,
          model: this.model,
          adapter: this.version,
        },
      },
    });
    try {
      return await this.choices[this.index].runTurn(selectedInput());
    } catch (error) {
      if (
        input.signal.aborted ||
        !(error instanceof AppError) ||
        !fallbackCodes.has(error.code) ||
        this.index + 1 >= this.choices.length
      )
        throw error;
      this.index++;
      // New provider sees governed results, never another provider's opaque wire
      // state. Completed capabilities are not executed again during fallback.
      return this.choices[this.index].runTurn(selectedInput());
    }
  }
}
export function createManagerAdapter(preferences: AIPreferences) {
  return new FallbackManagerAdapter(
    managerConfiguration(preferences).map(({ provider, model }) =>
      provider === 'openai'
        ? new ResponsesManagerAdapter(model)
        : new AnthropicManagerAdapter(model),
    ),
  );
}
export function aggregateManagerUsage(usage: ManagerUsage[]) {
  const totals = new Map<string, ManagerUsage>();
  for (const row of usage) {
    const key = row.provider;
    const current = totals.get(key);
    if (current) {
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.totalTokens += row.totalTokens;
      if (!current.model.split(',').includes(row.model))
        current.model += ',' + row.model;
    } else totals.set(key, { ...row });
  }
  return [...totals.values()] as (ManagerUsage & {
    provider: AIProviderName;
  })[];
}
