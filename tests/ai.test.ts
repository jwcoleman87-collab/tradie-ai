import { it, expect, vi } from 'vitest';
import { runTeam, type ModelProvider, OpenAIProvider } from '../lib/server/ai';
import { RouteOutput } from '../lib/contracts';
it('routes multiple agents and records real managed skill hashes', async () => {
  const inputs: unknown[] = [];
  const provider = {
    model: 'test-only',
    structured: vi
      .fn()
      .mockImplementation(async (_schema, instructions, input) => {
        inputs.push({ instructions, input });
        return inputs.length === 1
          ? {
              agents: ['marketing', 'finance', 'marketing'],
              reason: 'ad spend',
              webSearch: false,
              searchQuery: null,
            }
          : {
              reply: 'No connected ad spend records are available.',
              proposals: [],
              escalation: 'missing_information',
            };
      }),
  } as ModelProvider;
  const result = await runTeam(provider, {
    history: [{ role: 'user', content: 'Why did ad spend increase?' }],
    records: [],
    timeZone: 'Australia/Sydney',
    calendar: { available: false },
    attachments: [],
  });
  expect(result.agents).toEqual(['marketing', 'finance']);
  expect(result.versions).toHaveLength(2);
  expect(result.versions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(inputs[1])).toContain('Never spend');
  expect(inputs).toHaveLength(2);
});
it('does not grant an unselected agent a proposal', async () => {
  const provider = {
    model: 'test',
    structured: vi
      .fn()
      .mockResolvedValueOnce({
        agents: ['social'],
        reason: 'post',
        webSearch: false,
        searchQuery: null,
      })
      .mockResolvedValueOnce({
        reply: 'draft',
        proposals: [
          {
            agent: 'finance',
            type: 'draft.save',
            summary: 'draft',
            payload: { kind: 'note', title: 'a', body: 'b' },
          },
        ],
        escalation: 'none',
      }),
  } as ModelProvider;
  await expect(
    runTeam(provider, {
      history: [],
      records: [],
      timeZone: 'Australia/Sydney',
      calendar: {},
      attachments: [],
    }),
  ).rejects.toThrow();
});
it('accepts clear Facebook image permission without a magic phrase', async () => {
  const instructions: string[] = [];
  const provider = {
    model: 'test',
    structured: vi
      .fn()
      .mockImplementation(async (_schema, systemInstructions) => {
        instructions.push(systemInstructions);
        return instructions.length === 1
          ? {
              agents: ['social'],
              reason: 'facebook photo',
              webSearch: false,
              searchQuery: null,
            }
          : { reply: 'Ready for approval', proposals: [], escalation: 'none' };
      }),
  } as ModelProvider;
  await runTeam(provider, {
    history: [
      {
        role: 'user',
        content: 'I own this image and have permission to publish it.',
      },
    ],
    records: [],
    timeZone: 'Australia/Sydney',
    calendar: {},
    attachments: [],
  });
  expect(instructions[1]).toContain(
    'Do not require the owner to repeat a magic phrase or exact wording.',
  );
  expect(instructions[1]).toContain(
    'do not ask them to repeat themselves: propose facebook.publish',
  );
});
it('requests non-stored structured output with no execution tools', async () => {
  process.env.OPENAI_API_KEY = 'test-not-real';
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                agents: ['social'],
                reason: 'draft',
                webSearch: false,
                searchQuery: null,
              }),
            },
          ],
        },
      ],
    }),
  );
  try {
    await new OpenAIProvider().structured(RouteOutput, 'routing', []);
    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.store).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.text.format.strict).toBe(true);
  } finally {
    fetchMock.mockRestore();
    delete process.env.OPENAI_API_KEY;
  }
});
