import { it, expect, vi } from 'vitest';
import { runTeam, type ModelProvider, OpenAIProvider } from '../lib/server/ai';
import { RouteOutput } from '../lib/contracts';

it('routes with a small context before retrieving optional workspace or Calendar data', async () => {
  let routed!: (value: unknown) => void;
  const route = new Promise((resolve) => {
    routed = resolve;
  });
  const structured = vi.fn().mockReturnValueOnce(route).mockResolvedValueOnce({
    reply: 'Caption ready',
    proposals: [],
    escalation: 'none',
  });
  const loadCalendar = vi.fn();
  const loadRecords = vi.fn().mockResolvedValue([]);
  const loadAttachments = vi.fn().mockResolvedValue([]);
  const result = runTeam(
    { model: 'test', structured },
    {
      history: Array.from({ length: 20 }, () => ({
        role: 'user',
        content: 'x'.repeat(5000),
      })),
      timeZone: 'Australia/Sydney',
      loadCalendar,
      loadRecords,
      loadAttachments,
    },
  );
  expect(loadCalendar).not.toHaveBeenCalled();
  expect(loadRecords).not.toHaveBeenCalled();
  expect(loadAttachments).not.toHaveBeenCalled();
  const routingCall = structured.mock.calls[0];
  expect(routingCall[2]).toHaveLength(6);
  expect(
    routingCall[2].every(
      (message: { content: string }) => message.content.length <= 2000,
    ),
  ).toBe(true);
  expect(routingCall[3].maxOutputTokens).toBe(2048);
  expect(routingCall[3].purpose).toBe('routing');
  routed({
    agents: ['social'],
    reason: 'caption',
    calendarContext: false,
    webSearch: false,
    searchQuery: null,
  });
  await result;
  expect(loadRecords).toHaveBeenCalledWith(['social']);
  expect(loadAttachments).toHaveBeenCalledOnce();
  expect(loadCalendar).not.toHaveBeenCalled();
  expect(structured.mock.calls[1][3].maxOutputTokens).toBeUndefined();
});

it('reads fresh Calendar availability only when the router requests it', async () => {
  const calls: string[] = [];
  const structured = vi
    .fn()
    .mockImplementationOnce(async () => {
      calls.push('routing');
      return {
        agents: ['maintenance'],
        reason: 'booking',
        calendarContext: true,
        webSearch: false,
        searchQuery: null,
      };
    })
    .mockImplementationOnce(async (_schema, _instructions, input) => {
      calls.push('response');
      expect(JSON.stringify(input)).toContain('fresh-availability');
      return {
        reply: 'Availability checked',
        proposals: [],
        escalation: 'none',
      };
    });
  await runTeam(
    { model: 'test', structured },
    {
      history: [{ role: 'user', content: 'Check availability' }],
      timeZone: 'Australia/Sydney',
      loadCalendar: async (signal) => {
        expect(signal.aborted).toBe(false);
        calls.push('calendar');
        return { available: true, busy: 'fresh-availability' };
      },
    },
  );
  expect(calls).toEqual(['routing', 'calendar', 'response']);
});
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
              calendarContext: false,
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
        calendarContext: false,
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
              calendarContext: false,
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
                calendarContext: false,
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
