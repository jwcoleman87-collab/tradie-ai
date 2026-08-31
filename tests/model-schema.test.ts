import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentOutput } from '../lib/contracts';
import { modelSchema } from '../lib/server/model-schema';
import { OpenAIProvider } from '../lib/server/ai';
import { ClaudeProvider } from '../lib/server/claude';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

for (const name of ['openai', 'anthropic'] as const) {
  it(`${name} converts real tagged action output into supported unions`, () => {
    const output = modelSchema(AgentOutput, name);
    const json = JSON.stringify(output);
    expect(json).not.toContain('"oneOf":');
    expect(json).toContain('"anyOf":');
    expect(json).not.toContain('"format":"uri"');
    const fields = output.properties as Record<
      string,
      {
        items: {
          anyOf: {
            properties: Record<string, unknown>;
            additionalProperties: boolean;
          }[];
        };
      }
    >;
    expect(fields.proposals.items.anyOf).toHaveLength(4);
    expect(fields.proposals.items.anyOf.map((x) => x.properties.type)).toEqual([
      { type: 'string', const: 'facebook.publish' },
      { type: 'string', const: 'calendar.create' },
      { type: 'string', const: 'draft.save' },
      { type: 'string', const: 'record.create' },
    ]);
    expect(
      fields.proposals.items.anyOf.every(
        (x) => x.additionalProperties === false,
      ),
    ).toBe(true);
    expect(output.required).toEqual(['reply', 'proposals', 'escalation']);
  });

  it(`${name} preserves fields whose names look like schema keywords`, () => {
    const schema = modelSchema(
      z
        .object({ oneOf: z.string(), format: z.string(), pattern: z.string() })
        .strict(),
      name,
    );
    expect(Object.keys(schema.properties as object)).toEqual([
      'oneOf',
      'format',
      'pattern',
    ]);
  });

  it(`${name} still rejects semantically invalid proposals after generation`, async () => {
    vi.stubEnv('OPENAI_API_KEY', 'not-a-real-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'not-a-real-key');
    const text = JSON.stringify({
      reply: 'Draft only',
      escalation: 'none',
      proposals: [
        {
          type: 'calendar.create',
          agent: 'maintenance',
          summary: 'Invalid order',
          payload: {
            summary: 'Test',
            description: '',
            start: '2030-01-02T11:00:00+11:00',
            end: '2030-01-02T10:00:00+11:00',
            timeZone: 'Australia/Sydney',
          },
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        name === 'openai'
          ? {
              status: 'completed',
              output: [{ content: [{ type: 'output_text', text }] }],
            }
          : { stop_reason: 'end_turn', content: [{ type: 'text', text }] },
      ),
    );
    const provider =
      name === 'openai' ? new OpenAIProvider() : new ClaudeProvider();
    await expect(
      provider.structured(AgentOutput, 'test', []),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
}
