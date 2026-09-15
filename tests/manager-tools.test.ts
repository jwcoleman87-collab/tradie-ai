import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createManagerTools,
  managerServices,
} from '../lib/server/manager/tools';
import { ManagerRuntime } from '../lib/server/manager/runtime';
import { runManagerChat } from '../lib/server/manager/chat';
import { AppError } from '../lib/server/errors';
import { loadTradeIntelligence } from '../lib/server/trade-intelligence';
import { calculateManagedQuote } from '../lib/server/manager/quote';
import type {
  ManagerModelAdapter,
  ManagerTurnResult,
} from '../lib/server/manager/contracts';

const workspaceId = crypto.randomUUID(),
  foreignWorkspace = crypto.randomUUID(),
  userId = crypto.randomUUID(),
  conversationId = crypto.randomUUID();
const localAction = crypto.randomUUID(),
  foreignAction = crypto.randomUUID(),
  localRecord = crypto.randomUUID(),
  foreignRecord = crypto.randomUUID(),
  connectionId = crypto.randomUUID();
const preferences = {
  ai_primary_provider: 'openai' as const,
  ai_allowed_providers: ['openai' as const],
  ai_fallback_enabled: false,
};
const writes: { table: string; data: unknown }[] = [];
const queries: { table: string; filters: [string, unknown][] }[] = [];
let revoked = false,
  active = true,
  consent = true;
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
        workspace_type: 'sandbox',
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
        website_url: null,
        base_location: 'Braidwood NSW',
        service_areas: ['Queanbeyan'],
        services: ['Hydro excavation'],
        preferred_job_types: [],
        brand_summary: null,
        confirmed_at: '2026-09-01T00:00:00Z',
        managed_pack: 'greenvac',
      },
    ],
    business_records: [
      {
        workspace_id: workspaceId,
        id: localRecord,
        kind: 'job',
        title: 'GreenVac job',
        body: 'John: 4 weekday hours in Queanbeyan. Spoil left on site.',
        status: 'active',
        source: 'owner_supplied',
      },
      {
        workspace_id: foreignWorkspace,
        id: foreignRecord,
        kind: 'job',
        title: 'Werka only',
        body: 'FOREIGN-PRIVATE-RECORD',
        status: 'active',
        source: 'owner_supplied',
      },
    ],
    proposed_actions: [
      {
        workspace_id: workspaceId,
        conversation_id: conversationId,
        id: localAction,
        agent: 'social',
        action_type: 'facebook.publish',
        summary: 'Saved test post',
        status: 'failed',
        error_code: 'PUBLISHING_DISABLED',
        created_at: '2026-09-01T00:00:00Z',
        expires_at: '2026-09-02T00:00:00Z',
        payload: {},
        execution_result: null,
      },
      {
        workspace_id: foreignWorkspace,
        id: foreignAction,
        summary: 'FOREIGN-PRIVATE-ACTION',
        action_type: 'facebook.publish',
        status: 'failed',
      },
    ],
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
      },
    ],
    uploaded_files: [],
    external_publish_attempts: [],
    agent_runs: [],
  };
  function from(table: string) {
    let fields = '*',
      limit = Infinity,
      data: unknown;
    const filters: [string, unknown][] = [];
    queries.push({ table, filters });
    const result = () => {
      if (data !== undefined) {
        writes.push({ table, data });
        return { data: [], error: null, count: 0 };
      }
      let rows = (tables[table] || [])
        .map((row) =>
          table === 'workspaces'
            ? {
                ...row,
                status: active ? 'active' : 'archived',
                ai_consent_at: consent ? '2026-09-01' : null,
              }
            : row,
        )
        .filter((row) => filters.every(([key, value]) => row[key] === value));
      const count = rows.length;
      rows = rows
        .slice(0, limit)
        .map((row) =>
          fields === '*'
            ? row
            : Object.fromEntries(
                fields.split(',').map((key) => [key, row[key]]),
              ),
        );
      return { data: rows, error: null, count };
    };
    const chain = {
      select: (value: string) => {
        fields = value;
        return chain;
      },
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return chain;
      },
      order: () => chain,
      or: () => chain,
      in: () => chain,
      lte: () => chain,
      limit: (value: number) => {
        limit = value;
        return chain;
      },
      abortSignal: () => chain,
      maybeSingle: async () => {
        const value = result();
        return { ...value, data: value.data[0] || null };
      },
      single: async () => {
        const value = result();
        return { ...value, data: value.data[0] || null };
      },
      update: (value: unknown) => {
        data = value;
        return chain;
      },
      insert: (value: unknown) => {
        data = value;
        return chain;
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
      getUser: async () => ({
        data: { user: revoked ? null : { id: userId } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}
function setup(overrides: Partial<typeof managerServices> = {}) {
  const db = database();
  const context = {
    db,
    admin: db,
    workspaceId,
    userId,
    conversationId,
    preferences,
  };
  return {
    context,
    tools: createManagerTools(context, { ...managerServices, ...overrides }),
  };
}
const signal = () => AbortSignal.timeout(5000);
beforeEach(() => {
  writes.length = 0;
  queries.length = 0;
  revoked = false;
  active = true;
  consent = true;
  vi.stubEnv('MANAGER_ENABLED', 'true');
  vi.stubEnv('MANAGER_WORKSPACE_IDS', workspaceId);
  vi.stubEnv('MANAGER_OWNER_IDS', userId);
});
afterEach(() => vi.unstubAllEnvs());

it('retains prepared work and checkpoints a truthful partial result after a later model failure', async () => {
  const { context } = setup();
  let first = true;
  const adapter: ManagerModelAdapter = {
    provider: 'fable',
    model: 'fable-19',
    version: 'fake-v1',
    usage: [],
    attempts: [],
    async runTurn() {
      if (!first) throw new AppError('AI_TIMEOUT', 503);
      first = false;
      return {
        kind: 'tools',
        calls: [
          {
            id: 'prepare_1',
            name: 'quotes.prepare',
            arguments: {
              title: 'Preserved quote',
              scope: 'Four known hours',
              hours: 4,
              distanceKm: 0,
              includedLocality: 'none',
              afterHours: false,
              assumptions: ['Owner must confirm access'],
            },
          },
        ],
      };
    },
  };
  const result = await runManagerChat(
    context,
    {
      history: [],
      name: 'GreenVac',
      timeZone: 'Australia/Sydney',
      runId: crypto.randomUUID(),
      signal: signal(),
      deadlineAt: Date.now() + 1000,
    },
    adapter,
  );
  expect(result.partial).toBe(true);
  expect(result.proposals).toHaveLength(1);
  expect(result.reply).toContain('AI_TIMEOUT');
  expect(result.providerTrace.at(-1)).toMatchObject({
    manager: {
      status: 'partial',
      tools: [{ name: 'quotes.prepare', status: 'completed' }],
    },
  });
  expect(writes[0]).toMatchObject({ table: 'agent_runs' });
});

it('identifies the selected sandbox explicitly even when the business name matches', async () => {
  const { tools } = setup();
  const result = await tools.invoke('workspace.read_summary', {}, signal());
  expect(result).toMatchObject({
    data: { id: workspaceId, name: 'GreenVac', workspace_type: 'sandbox' },
  });
  expect(
    queries
      .filter((query) => query.table === 'workspaces')
      .every((query) =>
        query.filters.some(
          ([key, value]) => key === 'id' && value === workspaceId,
        ),
      ),
  ).toBe(true);
});

it('reads live workspace records without merging another business', async () => {
  const { tools } = setup();
  const result = await tools.invoke(
    'records.search',
    { query: '', kind: null },
    signal(),
  );
  expect(JSON.stringify(result)).toContain('GreenVac job');
  expect(JSON.stringify(result)).not.toContain('FOREIGN-PRIVATE');
  expect(
    queries.find((query) => query.table === 'business_records')?.filters,
  ).toContainEqual(['workspace_id', workspaceId]);
});
it.each([
  ['records.get', foreignRecord],
  ['actions.get_status', foreignAction],
  ['files.get_metadata', foreignRecord],
])('rejects foreign entity in %s', async (name, id) => {
  const { tools } = setup();
  await expect(tools.invoke(name, { id }, signal())).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
it.each(['workspace_id', 'workspaceId', 'userId'])(
  'cannot override authenticated scope using %s',
  async (key) => {
    const { tools } = setup();
    await expect(
      tools.invoke('connections.list', { [key]: foreignWorkspace }, signal()),
    ).rejects.toMatchObject({ code: 'MANAGER_INPUT_INVALID' });
    expect(queries).toHaveLength(0);
  },
);
it('pins connection lookup and refuses a foreign connection ID before contacting the provider', async () => {
  const verify = vi.fn();
  const { tools } = setup({ verifyProviderConnection: verify });
  await expect(
    tools.invoke(
      'connections.health',
      { provider: 'facebook', connectionId: crypto.randomUUID() },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(verify).not.toHaveBeenCalled();
  expect(
    queries.find((query) => query.table === 'integration_credentials')?.filters,
  ).toContainEqual(['workspace_id', workspaceId]);
});
it('excludes credentials from current connection output', async () => {
  const { tools } = setup();
  const result = JSON.stringify(
    await tools.invoke('connections.list', {}, signal()),
  );
  expect(result).toContain('Werka Mechanical Hitch');
  expect(result).not.toMatch(/PRIVATE-OAUTH|CIPHERTEXT|token/);
});
it.each(['session', 'consent', 'archive', 'rollout'])(
  'revalidates %s at every tool invocation',
  async (which) => {
    const { tools } = setup();
    await tools.invoke(
      'calculate',
      { operation: 'add', left: 2, right: 3 },
      signal(),
    );
    if (which === 'session') revoked = true;
    if (which === 'consent') consent = false;
    if (which === 'archive') active = false;
    if (which === 'rollout') vi.stubEnv('MANAGER_ENABLED', 'false');
    await expect(
      tools.invoke(
        'calculate',
        { operation: 'add', left: 2, right: 4 },
        signal(),
      ),
    ).rejects.toBeDefined();
  },
);
it('invokes the shared diagnosis service directly with server-owned scope', async () => {
  const diagnosis = vi.fn().mockResolvedValue({
    requestId: crypto.randomUUID(),
    observedAt: '2026-09-15T00:00:00Z',
    evidence: { errorCode: 'PUBLISHING_DISABLED' },
    report: null,
    usage: [],
  });
  const { tools, context } = setup({ diagnoseOperation: diagnosis });
  await tools.invoke(
    'diagnosis.run',
    { kind: 'action', targetId: localAction },
    signal(),
  );
  expect(diagnosis).toHaveBeenCalledWith(
    { workspaceId, kind: 'action', targetId: localAction },
    context.db,
    context.admin,
    userId,
    expect.any(AbortSignal),
    expect.any(Function),
  );
});
it('coordinates live action discovery, status, diagnosis and connection evidence without owner ferrying', async () => {
  const diagnosis = vi.fn().mockResolvedValue({
    requestId: crypto.randomUUID(),
    observedAt: '2026-09-15T00:00:00Z',
    evidence: { errorCode: 'PUBLISHING_DISABLED' },
    report: {
      likelyCause: 'Publishing was disabled at the recorded attempt.',
      confidence: 'medium',
      recommendations: [
        {
          owner: 'workspace_owner',
          step: 'Review the selected Facebook connection.',
        },
      ],
      missingEvidence: [],
    },
    usage: [],
  });
  const { tools } = setup({ diagnoseOperation: diagnosis });
  const script = [
    {
      name: 'actions.list',
      arguments: { type: 'facebook.publish', status: 'failed' },
    },
    { name: 'actions.get_status', arguments: { id: localAction } },
    {
      name: 'diagnosis.run',
      arguments: { kind: 'action', targetId: localAction },
    },
    { name: 'connections.list', arguments: {} },
  ];
  const adapter: ManagerModelAdapter = {
    provider: 'fable',
    model: 'fable-19',
    version: 'fake-v1',
    usage: [],
    attempts: [],
    async runTurn(input) {
      const next = script.shift();
      if (next)
        return { kind: 'tools', calls: [{ id: crypto.randomUUID(), ...next }] };
      expect(input.results).toHaveLength(4);
      expect(input.results.every((result) => result.ok)).toBe(true);
      return {
        kind: 'final',
        answer: {
          reply:
            'The saved attempt was blocked. Review the selected Facebook Page before retrying.',
          escalation: 'none',
          attention: 'contained',
          shortcut: 'facebook_connection',
        },
      };
    },
  };
  const runtime = new ManagerRuntime(adapter, tools);
  const result = await runtime.run({
    instructions: 'Diagnose',
    messages: [],
    context: { role: 'owner' },
    signal: signal(),
  });
  expect(result.partial).toBe(false);
  expect(diagnosis).toHaveBeenCalledOnce();
  expect(writes).toHaveLength(0);
});
it('loads the real GreenVac pack and prepares a calculated quote artifact through existing draft.save', async () => {
  const { tools } = setup();
  const result = await tools.invoke(
    'quotes.prepare',
    {
      title: 'John test quote',
      scope: 'Pothole exposed services, four weekday hours in Queanbeyan',
      hours: 4,
      distanceKm: 70,
      includedLocality: 'Queanbeyan',
      afterHours: false,
      assumptions: ['Spoil left on site; access subject to owner confirmation'],
    },
    signal(),
  );
  expect(JSON.stringify(result)).toContain('740');
  expect(tools.proposals).toMatchObject([
    {
      type: 'draft.save',
      agent: 'finance',
      payload: { title: 'John test quote', kind: 'note' },
    },
  ]);
  expect(tools.proposals[0].payload).toHaveProperty(
    'body',
    expect.stringContaining('AUD 740.00 inc GST'),
  );
  expect([...tools.selected]).toContain('finance');
  expect(tools.versions.map((v) => v.agent)).toEqual(['ops', 'finance']);
  expect(writes).toHaveLength(0); // Atomic complete_chat owns durable preparation.
});
it('refuses an unassigned rate pack and enforces minimum, travel and after-hours rules', async () => {
  const base = {
    title: 'Estimate',
    scope: 'Known test scope',
    hours: 1,
    distanceKm: 0,
    includedLocality: 'none' as const,
    afterHours: false,
    assumptions: [],
  };
  const pack = await loadTradeIntelligence({
    managed_pack: 'greenvac',
    workspace_id: workspaceId,
  });
  expect(calculateManagedQuote(pack, base).total).toBe(650);
  expect(
    calculateManagedQuote(pack, {
      ...base,
      hours: 4,
      distanceKm: 120,
      afterHours: true,
    }),
  ).toMatchObject({ labour: 1110, travel: 209, total: 1319 });
  const unassigned = await loadTradeIntelligence({
    workspace_id: foreignWorkspace,
  });
  expect(() => calculateManagedQuote(unassigned, base)).toThrow();
});
it('prepares a typed calendar action but never invokes approval or execution', async () => {
  const { tools } = setup({
    connectionList: async () => [
      {
        provider: 'google_calendar',
        configured: true,
        connectionId,
        status: 'connected',
        externalId: 'primary',
        displayName: 'Primary',
        verifiedAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
        capabilities: ['calendar.create'],
      },
    ],
  });
  const proposal = {
    type: 'calendar.create',
    agent: 'maintenance',
    summary: 'Review booking',
    payload: {
      summary: 'Test',
      description: 'Internal test preparation',
      start: '2030-09-16T09:00:00+10:00',
      end: '2030-09-16T10:00:00+10:00',
      timeZone: 'Australia/Sydney',
    },
  };
  await tools.invoke('actions.prepare', { proposal }, signal());
  expect(tools.proposals).toEqual([proposal]);
  expect(writes).toHaveLength(0);
  expect(
    tools.definitions.some((tool) =>
      /execute|approve|publish$/.test(tool.name),
    ),
  ).toBe(false);
});
it('checkpoints model identity and safe tool metadata in agent_runs using a fake second adapter', async () => {
  const { context } = setup();
  let first = true;
  const adapter: ManagerModelAdapter = {
    provider: 'fable',
    model: 'fable-19',
    version: 'fake-v1',
    usage: [],
    attempts: [],
    async runTurn(): Promise<ManagerTurnResult> {
      if (first) {
        first = false;
        return {
          kind: 'tools',
          calls: [
            {
              id: 'calculation',
              name: 'calculate',
              arguments: { operation: 'multiply', left: 185, right: 4 },
            },
          ],
        };
      }
      return {
        kind: 'final',
        answer: {
          reply: 'The calculation is 740.',
          escalation: 'none',
          attention: 'contained',
          shortcut: null,
        },
      };
    },
  };
  const result = await runManagerChat(
    context,
    {
      history: [{ role: 'user', content: 'PRIVATE-PROMPT' }],
      name: 'GreenVac',
      timeZone: 'Australia/Sydney',
      runId: crypto.randomUUID(),
      signal: signal(),
    },
    adapter,
  );
  expect(result.model).toBe('fable-19');
  expect(result.providerTrace.at(-1)).toMatchObject({
    provider: 'fable',
    manager: { runtime: 'manager-v1' },
  });
  expect(writes[0]).toMatchObject({
    table: 'agent_runs',
    data: { model: 'fable-19' },
  });
  expect(JSON.stringify(writes)).not.toMatch(
    /PRIVATE-PROMPT|PRIVATE-OAUTH|multiply|"left"/,
  );
});
