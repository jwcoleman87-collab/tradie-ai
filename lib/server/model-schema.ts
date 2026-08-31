import { z } from 'zod';
import type { AIProviderName } from '../ai-settings';

const openaiFormats = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
]);
const claudeUnsupported = new Set([
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

// Transport compatibility only: both adapters validate the ORIGINAL Zod schema
// after generation. No semantic, approval, or execution checks are relaxed.
export function modelSchema(
  schema: z.ZodType,
  provider: AIProviderName,
): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const constraints: string[] = [];
    for (const [key, item] of Object.entries(source)) {
      if (key === '$schema') continue;
      // These maps contain user-defined names, not JSON Schema keywords.
      if (key === 'properties' || key === '$defs') {
        result[key] = Object.fromEntries(
          Object.entries(item as Record<string, unknown>).map(
            ([name, definition]) => [name, walk(definition)],
          ),
        );
      } else if (key === 'oneOf') {
        // Zod 4 emits oneOf for our tagged proposals; neither API accepts it.
        // Distinct literal action tags make these branches mutually exclusive.
        result.anyOf = walk(item);
      } else if (
        (provider === 'anthropic' && claudeUnsupported.has(key)) ||
        (provider === 'openai' &&
          key === 'format' &&
          !openaiFormats.has(String(item)))
      ) {
        constraints.push(key + '=' + JSON.stringify(item));
      } else result[key] = walk(item);
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
