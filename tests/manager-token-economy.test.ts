import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createManagerTools,
  managerServices,
} from '../lib/server/manager/tools';
import {
  MANAGER_LIMITS,
  ManagerRuntime,
  sumUsage,
} from '../lib/server/manager/runtime';
import {
  boundedHistory,
  managerInstructions,
} from '../lib/server/manager/chat';
import {
  AnthropicManagerAdapter,
  ResponsesManagerAdapter,
  aggregateManagerUsage,
} from '../lib/server/manager/adapters';
import type {
  ManagerModelAdapter,
  ManagerTurnInput,
  ManagerUsage,
} from '../lib/server/manager/contracts';

// Token-economy regression tests. They protect the harness against context
// bloat: the Manager must be ABLE to fetch anything, but only be GIVEN what the
// current request needs. Scripted adapters stand in for the model so the
// assertions are about what Workbench loads, not about model quality.

const workspaceId = crypto.randomUUID(),
  userId = crypto.randomUUID(),
  conversationId = crypto.randomUUID(),
  actionId = crypto.randomUUID(),
  connectionId = crypto.randomUUID();
const preferences = {
  ai_primary_provider: 'openai' as const,
  ai_allowed_providers: ['openai' as const],
  ai_fallback_enabled: false,
};
const queried: string[] = [];
type Row = Record<string, unknown>;
function database() {
  const tables: Record<string, Row[]> = {
    workspace_members: [
      { workspace_id: workspaceId, user_id: userId, role: 'owner' },
    ],
    workspaces: [
      {
        id: workspaceId,
        name: 'GreenVac',
        workspace_type: 'business',
        time_zone: 'Australia/Sydney',
        status: 'active',
        ai_consent_at: '2026-09-01',
        ...preferences,
      },
    ],
    business_profiles: [
      {
        workspace_id: workspaceId,
        onboarding_status: 'confirmed',
        display_name: 'GreenVac',
        managed_pack: 'greenvac',
      },
    ],
    business_records: Array.from({ length: 30 }, (_, i) => ({
      workspace_id: workspaceId,
      id: crypto.randomUUID(),
      kind: 'job',
      title: `Job ${i}`,
      body: 'x'.repeat(4000),
      status: 'active',
      source: 'owner_supplied',
    })),
    proposed_actions: Array.from({ length: 17 }, (_, i) => ({
      workspace_id: workspaceId,
      conversation_id: conversationId,
      id: i === 0 ? actionId : crypto.randomUUID(),
      agent: 'social',
      action_type: 'facebook.publish',
      summary: `Historical post ${i}`,
      status: 'failed',
      error_code: 'FACEBOOK_ACCESS_REVOKED',
      created_at: '2026-09-01T00:00:00Z',
      expires_at: '2026-09-02T00:00:00Z',
      payload: { text: 'y'.repeat(3000) },
      execution_result: null,
    })),
    integration_credentials: [
      {
        workspace_id: workspaceId,
        provider: 'facebook',
        connection_id: connectionId,
        display_name: 'Werka Mechanical Hitch',
        external_id: '112658584407090',
        status: 'reconnect_required',
        verified_at: null,
        last_error_code: 'FACEBOOK_ACCESS_REVOKED',
        last_error_at: '2026-09-03T00:00:00Z',
        token: 'PRIVATE-OAUTH-TOKEN',
        token_ciphertext: 'PRIVATE-CIPHERTEXT',
        metadata: { oauth: 'z'.repeat(5000) },
      },
    ],
    external_publish_attempts: [],
  };
  function from(table: string) {
    queried.push(table);
    let fields = '*',
      limit = Infinity;
    const filters: [string, unknown][] = [];
    const result = () => {
      const rows = (tables[table] || [])
        .filter((row) => filters.every(([key, value]) => row[key] === value))
        .slice(0, limit)
        .map((row) =>
          fields === '*'
            ? row
            : Object.fromEntries(
                fields.split(',').map((key) => [key, row[key]]),
              ),
        );
      return { data: rows, error: null, count: rows.length };
    };
    const chain = {
      select: (value: string) => ((fields = value), chain),
      eq: (key: string, value: unknown) => (filters.push([key, value]), chain),
      order: () => chain,
      or: () => chain,
      in: () => chain,
      lte: () => chain,
      limit: (value: number) => ((limit = value), chain),
      abortSignal: () => chain,
      maybeSingle: async () => {
        const value = result();
        return { ...value, data: value.data[0] || null };
      },
      single: async () => {
        const value = result();
        return { ...value, data: value.data[0] || null };
      },
      // eslint-disable-next-line unicorn/no-thenable -- Match Supabase's awaitable query contract.
      then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return chain;
  }
  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  } as unknown as SupabaseClient;
}
function setup(overrides: Partial<typeof managerServices> = {}) {
  const db = database();
  return createManagerTools(
    { db, admin: db, workspaceId, userId, conversationId, preferences },
    { ...managerServices, ...overrides },
  );
}
const scripted = (
  script: { name: string; arguments: unknown }[],
  usage: ManagerUsage[] = [],
): ManagerModelAdapter & { seen: ManagerTurnInput[] } => ({
  provider: 'fable',
  model: 'fable-19',
  version: 'fake-v1',
  usage,
  attempts: [],
  seen: [],
  async runTurn(input) {
    this.seen.push({ ...input, results: structuredClone(input.results) });
    const next = script.shift();
    if (next)
      return { kind: 'tools', calls: [{ id: crypto.randomUUID(), ...next }] };
    return {
      kind: 'final',
      answer: {
        reply: 'Done.',
        escalation: 'none',
        attention: 'contained',
        shortcut: null,
      },
    };
  },
});
const run = (adapter: ManagerModelAdapter, tools = setup()) =>
  new ManagerRuntime(adapter, tools).run({
    instructions: managerInstructions,
    messages: [{ role: 'user', content: 'Which Facebook page is connected?' }],
    context: { role: 'owner', workspaceName: 'GreenVac' },
    signal: AbortSignal.timeout(5000),
  });

beforeEach(() => {
  queried.length = 0;
  vi.stubEnv('MANAGER_ENABLED', 'true');
  vi.stubEnv('MANAGER_WORKSPACE_IDS', workspaceId);
  vi.stubEnv('MANAGER_OWNER_IDS', userId);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('keeps the default Manager orientation minimal: no skills, packs, records or actions up front', () => {
  const tools = setup();
  // Instructions and tool descriptions are sent on every model call.
  expect(managerInstructions.length).toBeLessThan(5000);
  const descriptions = tools.definitions.reduce(
    (n, tool) => n + tool.description.length,
    0,
  );
  expect(descriptions).toBeLessThan(4500);
  expect(tools.definitions.every((t) => t.description.length < 400)).toBe(true);
  // Nothing is loaded until a tool asks for it.
  expect(tools.selected.size).toBe(0);
  expect(tools.versions).toHaveLength(0);
  expect(queried).toEqual([]);
});

it('A: "Which Facebook page is connected?" loads only connection evidence', async () => {
  const adapter = scripted([{ name: 'connections.list', arguments: {} }]);
  const tools = setup();
  const result = await run(adapter, tools);
  expect(result.partial).toBe(false);
  // Only the connection table was read: no records, actions, skills or pack.
  expect(new Set(queried.filter((t) => t !== 'workspaces'))).toEqual(
    new Set(['workspace_members', 'integration_credentials']),
  );
  expect(tools.selected.size).toBe(0);
  expect(tools.versions).toHaveLength(0);
  // The evidence is a compact projection, not the credential row.
  const evidence = JSON.stringify(adapter.seen[1].results[0].evidence);
  expect(evidence.length).toBeLessThan(1200);
  expect(evidence).not.toMatch(/PRIVATE|zzzz|oauth/);
  expect(evidence).toContain('Werka Mechanical Hitch');
  expect(evidence).toContain('FACEBOOK_ACCESS_REVOKED');
});

it('B: "Raise a GreenVac quote" loads finance/trade intelligence but no social, website or Facebook history', async () => {
  const adapter = scripted([
    {
      name: 'quotes.prepare',
      arguments: {
        title: 'Test quote',
        scope: 'Four weekday hours in Queanbeyan',
        hours: 4,
        distanceKm: 70,
        includedLocality: 'Queanbeyan',
        afterHours: false,
        assumptions: [],
      },
    },
  ]);
  const tools = setup();
  expect((await run(adapter, tools)).partial).toBe(false);
  expect([...tools.selected]).toEqual(['finance']);
  expect(tools.versions.map((v) => v.agent).sort()).toEqual(['finance', 'ops']);
  expect(queried).not.toContain('proposed_actions');
  expect(queried).not.toContain('integration_credentials');
  // The pack text itself is not echoed back to the model; only the calculation.
  const evidence = JSON.stringify(adapter.seen[1].results[0].evidence);
  expect(evidence.length).toBeLessThan(1500);
  expect(evidence).not.toContain('version:');
});

it('C: "Why did this action fail?" retrieves one action and its diagnosis, not the workspace', async () => {
  const diagnosis = vi.fn().mockResolvedValue({
    requestId: crypto.randomUUID(),
    observedAt: '2026-09-15T00:00:00Z',
    evidence: { errorCode: 'FACEBOOK_ACCESS_REVOKED' },
    report: null,
    usage: [],
  });
  const adapter = scripted([
    {
      name: 'actions.list',
      arguments: { type: 'facebook.publish', status: 'failed' },
    },
    { name: 'actions.get_status', arguments: { id: actionId } },
    {
      name: 'diagnosis.run',
      arguments: { kind: 'action', targetId: actionId },
    },
  ]);
  const tools = setup({ diagnoseOperation: diagnosis });
  const runtime = new ManagerRuntime(adapter, tools);
  const result = await runtime.run({
    instructions: managerInstructions,
    messages: [{ role: 'user', content: 'Why did my last post fail?' }],
    context: { role: 'owner' },
    signal: AbortSignal.timeout(5000),
  });
  expect(result.partial).toBe(false);
  const final = adapter.seen.at(-1)!.results;
  // Seventeen failures exist; the model sees at most eight compact rows and
  // one full action, never every payload.
  const list = final[0].evidence as { data: { actions: unknown[] } };
  expect(list.data.actions).toHaveLength(8);
  expect(JSON.stringify(final[0].evidence).length).toBeLessThan(2500);
  expect(JSON.stringify(final[1].evidence).length).toBeLessThan(4000);
  expect(queried).not.toContain('business_records');
  expect(tools.selected.size).toBe(0);
  expect(runtime.economy).toMatchObject({
    modelCalls: 4,
    toolCalls: 3,
    stopReason: 'final',
  });
  expect(Object.keys(runtime.economy.evidenceChars).sort()).toEqual([
    'actions.get_status',
    'actions.list',
    'diagnosis.run',
  ]);
  expect(runtime.economy.contextChars).toBeGreaterThan(
    managerInstructions.length,
  );
});

it('stops before another model call once the run token budget is spent', async () => {
  const usage: ManagerUsage[] = [];
  const adapter = scripted(
    [
      { name: 'connections.list', arguments: {} },
      { name: 'files.list', arguments: {} },
    ],
    usage,
  );
  const original = adapter.runTurn.bind(adapter);
  adapter.runTurn = async (input) => {
    const next = await original(input);
    usage.push({
      provider: 'fable',
      model: 'fable-19',
      inputTokens: 700,
      outputTokens: 100,
      totalTokens: 800,
    });
    return next;
  };
  const tools = setup();
  const runtime = new ManagerRuntime(adapter, tools);
  const result = await runtime.run(
    {
      instructions: 'x',
      messages: [],
      context: { role: 'owner' },
      signal: AbortSignal.timeout(5000),
    },
    { totalTokens: 1000 },
  );
  expect(result).toMatchObject({
    partial: true,
    errorCode: 'MANAGER_TOKEN_LIMIT',
  });
  // Two model calls spent 1600 tokens; the third was never started.
  expect(adapter.seen).toHaveLength(2);
  expect(runtime.economy).toMatchObject({
    modelCalls: 2,
    totalTokens: 1600,
    stopReason: 'budget',
  });
  expect(MANAGER_LIMITS.totalTokens).toBeGreaterThan(
    MANAGER_LIMITS.inputTokens,
  );
  expect(sumUsage(usage).cachedInputTokens).toBe(0);
});

it('bounds conversation history to a small recent window, keeping the latest message whole', () => {
  const history = [
    ...Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `old ${i} ` + 'h'.repeat(5000),
    })),
    { role: 'user', content: 'latest ' + 'l'.repeat(3000) },
  ];
  const kept = boundedHistory(history);
  expect(kept.length).toBeLessThanOrEqual(8);
  expect(kept.at(-1)!.content.startsWith('latest ')).toBe(true);
  expect(kept.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(
    12_000,
  );
  expect(kept.slice(0, -1).every((m) => m.content.length <= 2000)).toBe(true);
  expect(boundedHistory([])).toEqual([]);
});

it('marks the stable Anthropic prefix cacheable and records cached tokens as reused context', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'secret-test-key');
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              reply: 'ok',
              escalation: 'none',
              attention: 'contained',
              shortcut: null,
            }),
          },
        ],
        usage: {
          input_tokens: 40,
          output_tokens: 10,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 0,
        },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const adapter = new AnthropicManagerAdapter('test-claude');
  const tools = setup();
  await adapter.runTurn({
    instructions: managerInstructions,
    messages: [],
    context: { role: 'owner' },
    tools: tools.definitions,
    results: [],
    signal: AbortSignal.timeout(5000),
    maxOutputTokens: 100,
  });
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.system[0]).toMatchObject({
    cache_control: { type: 'ephemeral' },
  });
  expect(body.tools.at(-1)).toMatchObject({
    cache_control: { type: 'ephemeral' },
  });
  expect(body.tools.slice(0, -1).every((t: Row) => !t.cache_control)).toBe(
    true,
  );
  expect(adapter.usage[0]).toMatchObject({
    inputTokens: 940,
    cachedInputTokens: 900,
    totalTokens: 950,
  });
  expect(aggregateManagerUsage(adapter.usage)[0].cachedInputTokens).toBe(900);
});

it('records OpenAI cached prompt tokens when the Responses API reports them', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    reply: 'ok',
                    escalation: 'none',
                    attention: 'contained',
                    shortcut: null,
                  }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 20,
            total_tokens: 1020,
            input_tokens_details: { cached_tokens: 800 },
          },
        }),
      ),
    ),
  );
  const adapter = new ResponsesManagerAdapter('gpt-6-astra');
  await adapter.runTurn({
    instructions: 'x',
    messages: [],
    context: { role: 'owner' },
    tools: [],
    results: [],
    signal: AbortSignal.timeout(5000),
    maxOutputTokens: 100,
  });
  expect(adapter.usage[0]).toMatchObject({
    totalTokens: 1020,
    cachedInputTokens: 800,
  });
});
