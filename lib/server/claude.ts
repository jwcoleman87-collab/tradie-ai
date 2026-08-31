import { z } from 'zod';
import type { ModelProvider, ModelUsage } from './ai';
import { env, required } from './config';
import { AppError, requireValue } from './errors';
import {
  modelHttpError,
  modelTimeout,
  parseModelJson,
  boundedModelJson,
} from './model-http';
type Block =
  | { type: 'text'; text: string }
  | {
      type: 'image' | 'document';
      source: { type: 'base64'; media_type: string; data: string };
    };
type Message = { role: 'user' | 'assistant'; content: Block[] };
export function claudeMessages(input: unknown[]): Message[] {
  const messages: Message[] = [];
  for (const item of input) {
    const source = z
      .object({
        role: z.enum(['user', 'assistant']),
        content: z.union([z.string(), z.array(z.unknown())]),
      })
      .parse(item);
    const blocks: Block[] =
      typeof source.content === 'string'
        ? [{ type: 'text', text: source.content }]
        : source.content.map((value) => {
            const block = z.object({ type: z.string() }).loose().parse(value);
            if (block.type === 'input_text')
              return {
                type: 'text' as const,
                text: z.string().parse(block.text),
              };
            if (block.type === 'input_image' || block.type === 'input_file') {
              const data = z
                .string()
                .parse(
                  block.type === 'input_image'
                    ? block.image_url
                    : block.file_data,
                );
              const match = data.match(
                /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/,
              );
              requireValue(
                match &&
                  (block.type === 'input_image') ===
                    match[1].startsWith('image/'),
                'AI_ATTACHMENT_UNSUPPORTED',
                400,
              );
              return {
                type:
                  match[1] === 'application/pdf'
                    ? ('document' as const)
                    : ('image' as const),
                source: {
                  type: 'base64' as const,
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
            throw new AppError('AI_ATTACHMENT_UNSUPPORTED', 400);
          });
    const nonempty = blocks.filter((b) => b.type !== 'text' || b.text.trim());
    if (!nonempty.length) continue;
    const previous = messages.at(-1);
    if (previous?.role === source.role) previous.content.push(...nonempty);
    else messages.push({ role: source.role, content: nonempty });
  }
  if (!messages.length || messages[0].role !== 'user')
    messages.unshift({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Use the following conversation as data for the requested structured response.',
        },
      ],
    });
  // Do not use assistant-prefill, which newer Claude models reject.
  if (messages.at(-1)?.role !== 'user')
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Prepare the requested structured response without executing any action.',
        },
      ],
    });
  return messages;
}
export function claudeSchema(schema: z.ZodType): Record<string, unknown> {
  // Conservative transport subset. The ORIGINAL Zod schema still validates every
  // response; semantic/length/range constraints are never removed server-side.
  const unsupported = new Set([
    '$schema',
    'format',
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minItems',
    'maxItems',
  ]);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>,
      result: Record<string, unknown> = {};
    const constraints: string[] = [];
    for (const [key, v] of Object.entries(source)) {
      if (unsupported.has(key)) {
        if (key !== '$schema') constraints.push(key + '=' + JSON.stringify(v));
      } else if (key === 'properties' || key === '$defs')
        result[key] = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(
            ([name, definition]) => [name, walk(definition)],
          ),
        );
      else result[key] = walk(v);
    }
    if (constraints.length)
      result.description = [
        source.description,
        'Required validation: ' + constraints.join(', '),
      ]
        .filter(Boolean)
        .join('. ');
    return result;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}
export class ClaudeProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  model = env('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001';
  usage: ModelUsage[] = [];
  async structured<T>(
    schema: z.ZodType<T>,
    instructions: string,
    input: unknown[],
  ): Promise<T> {
    const key = required('ANTHROPIC_API_KEY');
    const maxTokens = Number(env('ANTHROPIC_MAX_OUTPUT_TOKENS') || 5000);
    requireValue(
      Number.isInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 8000,
      'AI_LIMIT_CONFIG_INVALID',
      503,
    );
    const payload = {
      model: this.model,
      max_tokens: maxTokens,
      system: instructions,
      messages: claudeMessages(input),
      output_config: {
        format: { type: 'json_schema', schema: claudeSchema(schema) },
      },
    };
    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(modelTimeout()),
        redirect: 'error',
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'AI_UNAVAILABLE',
        503,
        'Claude could not be reached. No actions were executed.',
      );
    }
    if (!response.ok) throw await modelHttpError(this.name, response);
    let data: {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
      usage?: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    try {
      data = (await boundedModelJson(response)) as typeof data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('AI_INVALID_RESPONSE', 502);
    }
    if (data.usage) {
      const inputTokens =
          data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens || 0) +
          (data.usage.cache_read_input_tokens || 0),
        outputTokens = data.usage.output_tokens;
      if (
        [inputTokens, outputTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        )
      )
        this.usage.push({
          provider: this.name,
          model: this.model,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });
    }
    if (data.stop_reason === 'refusal')
      throw new AppError(
        'AI_REFUSED',
        422,
        'Claude could not help with this request. No actions were executed.',
      );
    requireValue(
      data.stop_reason === 'end_turn',
      'AI_INCOMPLETE',
      502,
      'Claude could not finish this response within its request limit. No actions were executed.',
    );
    return parseModelJson(
      schema,
      data.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('') || '',
    );
  }
}
