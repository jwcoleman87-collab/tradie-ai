import { afterEach, expect, it, vi } from 'vitest';
import { OpenAIProvider, runTeam, type ModelProvider } from '../lib/server/ai';
import { ClaudeProvider } from '../lib/server/claude';
import {
  appendWebSources,
  publicSearchQuery,
} from '../lib/server/web-research';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('blocks private-looking search queries and emits only safe source links', () => {
  expect(() =>
    publicSearchQuery('customer@example.com overdue invoice'),
  ).toThrow();
  expect(() => publicSearchQuery('Bearer secret token')).toThrow();
  expect(publicSearchQuery('current NSW electrical licence rules')).toBe(
    'current NSW electrical licence rules',
  );
  expect(
    appendWebSources('Checked.', {
      summary: 'notes',
      searchedAt: '2026-09-02T00:00:00.000Z',
      provider: 'openai',
      sources: [{ title: 'NSW regulator', url: 'https://www.nsw.gov.au/' }],
    }),
  ).toContain('[NSW regulator](https://www.nsw.gov.au/)');
});

it('uses OpenAI hosted web search and retains provider citations', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'private-test-key');
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'Current public findings.',
              annotations: [
                {
                  type: 'url_citation',
                  title: 'Official source',
                  url: 'https://example.gov.au/current',
                },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    }),
  );
  const provider = new OpenAIProvider();
  const result = await provider.research(
    'current Australian small business update',
    'Australia/Sydney',
  );
  const payload = JSON.parse(mock.mock.calls[0][1]?.body as string);
  expect(payload.store).toBe(false);
  expect(payload.tools).toEqual([
    expect.objectContaining({ type: 'web_search' }),
  ]);
  expect(JSON.stringify(payload)).not.toContain('private-test-key');
  expect(result.sources).toEqual([
    {
      title: 'Official source',
      url: 'https://example.gov.au/current',
    },
  ]);
  expect(provider.usage[0].webSearches).toBe(1);
});

it('uses Claude hosted web search and retains mandatory citations', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'private-test-key');
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'web_search_tool_result',
          content: [
            {
              type: 'web_search_result',
              title: 'Australian source',
              url: 'https://example.gov.au/update',
            },
          ],
        },
        {
          type: 'text',
          text: 'Current public findings.',
          citations: [
            {
              type: 'web_search_result_location',
              title: 'Australian source',
              url: 'https://example.gov.au/update',
            },
          ],
        },
      ],
      usage: {
        input_tokens: 20,
        output_tokens: 10,
        server_tool_use: { web_search_requests: 1 },
      },
    }),
  );
  const provider = new ClaudeProvider();
  const result = await provider.research(
    'current Australian small business update',
    'Australia/Sydney',
  );
  const payload = JSON.parse(mock.mock.calls[0][1]?.body as string);
  expect(payload.tools[0]).toMatchObject({
    type: 'web_search_20250305',
    max_uses: 3,
  });
  expect(payload.output_config).toBeUndefined();
  expect(result.sources).toHaveLength(1);
  expect(provider.usage[0].webSearches).toBe(1);
});

it('researches only after routing and gives every selected agent cited context', async () => {
  vi.stubEnv('WEB_SEARCH_ENABLED', 'true');
  const calls: { instructions: string; input: unknown[] }[] = [];
  const research = vi.fn().mockResolvedValue({
    summary: 'Public research notes.',
    sources: [
      { title: 'Public source', url: 'https://example.gov.au/research' },
    ],
    searchedAt: '2026-09-02T00:00:00.000Z',
    provider: 'openai',
  });
  const provider = {
    name: 'openai',
    model: 'test',
    usage: [],
    attempts: [],
    structured: vi.fn(async (_schema, instructions, input) => {
      calls.push({ instructions, input });
      return calls.length === 1
        ? {
            agents: ['marketing', 'website'],
            reason: 'current competitor research',
            webSearch: true,
            searchQuery: 'current Australian trade services marketing trends',
          }
        : {
            reply: 'Here are the current findings.',
            proposals: [],
            escalation: 'none',
          };
    }),
    research,
  } as ModelProvider;
  const result = await runTeam(provider, {
    history: [{ role: 'user', content: 'Search current marketing trends.' }],
    records: [],
    timeZone: 'Australia/Sydney',
    calendar: {},
    attachments: [],
  });
  expect(research).toHaveBeenCalledOnce();
  expect(JSON.stringify(calls[1].input)).toContain('Public research notes.');
  expect(calls[1].instructions).toContain('untrusted data');
  expect(result.reply).toContain(
    '[Public source](https://example.gov.au/research)',
  );
});
