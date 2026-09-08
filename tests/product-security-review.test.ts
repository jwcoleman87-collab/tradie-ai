import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardingApi } from '../lib/server/onboarding-api';
import { AppError } from '../lib/server/errors';
import { memoryDb } from './fixtures/memory-db';

// Independent review tests. These call the real onboarding handler and its
// validation/membership logic, with a deterministic query/mutation fake and AI
// output stub. They do NOT establish authentication, RLS, browser, PostgREST,
// or independent-connection database concurrency behavior.
type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  db: {} as SupabaseClient,
  magic: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('../lib/server/db', async (original) => ({
  ...(await original<typeof import('../lib/server/db')>()),
  adminDb: () => mocks.db,
}));
vi.mock('../lib/server/ai-provider', () => ({
  createAIProvider: mocks.provider,
}));
vi.mock('../lib/server/onboarding', async (original) => ({
  ...(await original<typeof import('../lib/server/onboarding')>()),
  runOnboardingMagic: mocks.magic,
}));

const userId = '10000000-0000-4000-8000-000000000001';
const workspaceId = '20000000-0000-4000-8000-000000000001';
let tables: Record<string, Row[]>;
let writes: { table: string; operation: string; value: Row }[];
let failWrite: { table: string; operation: string } | undefined;
let rateCalls: number;

// Atomic RPC behavior is a contract stub here; actual trigger-driven rollback
// and grants are checked in onboarding-integrity-database.test.ts.
async function atomicRpc(name: string, params: Row) {
  const before = structuredClone(tables);
  const apply = async (query: PromiseLike<{ error: unknown }>) => {
    const result = await query;
    if (result.error) throw result.error;
  };
  const workspace = params.p_workspace;
  try {
    if (name === 'accept_onboarding_request') {
      let receipt = tables.onboarding_requests.find(
        (row) =>
          row.request_id === params.p_request && row.user_id === params.p_user,
      );
      if (
        receipt &&
        (receipt.answer !== params.p_answer ||
          receipt.allow_ai !== params.p_allow_ai ||
          receipt.workspace_id !== workspace)
      )
        throw Error('TAI:ONBOARDING_REQUEST_MISMATCH');
      const workspaceRow = tables.workspaces.find(
        (row) => row.id === workspace,
      )!;
      if (!receipt) {
        if (!workspaceRow.ai_consent_at && !params.p_allow_ai)
          throw Error('TAI:AI_CONSENT_REQUIRED');
        rateCalls++;
        workspaceRow.ai_consent_at ||= new Date().toISOString();
        let stored = tables.onboarding_sessions.find(
          (row) => row.workspace_id === workspace,
        );
        if (!stored) {
          stored = {
            id: crypto.randomUUID(),
            user_id: params.p_user,
            workspace_id: workspace,
            messages: [
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: params.p_opening,
                createdAt: new Date().toISOString(),
              },
            ],
            status: 'in_progress',
            information_goals: [],
            current_goal: 'identity_anchor',
            discovery_status: params.p_discovery,
          };
          tables.onboarding_sessions.push(stored);
        }
        (stored.messages as Row[]).push({
          id: params.p_request,
          role: 'user',
          content: params.p_answer,
          createdAt: new Date().toISOString(),
        });
        receipt = {
          user_id: params.p_user,
          workspace_id: workspace,
          request_id: params.p_request,
          answer: params.p_answer,
          allow_ai: params.p_allow_ai,
          status: 'queued',
        };
        tables.onboarding_requests.push(receipt);
      }
      const queue = tables.onboarding_requests.filter(
        (row) => row.workspace_id === workspace && row.status === 'queued',
      );
      if (
        receipt.status !== 'queued' ||
        tables.onboarding_requests.some(
          (row) => row.workspace_id === workspace && row.status === 'working',
        ) ||
        queue[0] !== receipt
      )
        return {
          data: { dispatch: false, status: receipt.status },
          error: null,
        };
      const stored = tables.onboarding_sessions.find(
        (row) => row.workspace_id === workspace,
      )!;
      const messages = stored.messages as Row[];
      receipt.status = 'working';
      receipt.execution_token = crypto.randomUUID();
      receipt.input_messages = structuredClone(
        messages.slice(
          0,
          messages.findIndex((row) => row.id === params.p_request) + 1,
        ),
      );
      return {
        data: {
          dispatch: true,
          status: 'working',
          token: receipt.execution_token,
          deadlineAt: new Date(Date.now() + 110000).toISOString(),
          session: {
            ...structuredClone(stored),
            messages: receipt.input_messages,
          },
          profile: structuredClone(
            tables.business_profiles.find(
              (row) => row.workspace_id === workspace,
            ) || null,
          ),
          facts: structuredClone(
            tables.business_profile_facts.filter(
              (row) => row.workspace_id === workspace,
            ),
          ),
        },
        error: null,
      };
    } else if (name === 'fail_onboarding_request') {
      const receipt = tables.onboarding_requests.find(
        (row) =>
          row.request_id === params.p_request &&
          row.execution_token === params.p_token &&
          row.status === 'working',
      );
      if (receipt)
        Object.assign(receipt, {
          status: 'failed',
          error_code: params.p_uncertain
            ? 'ONBOARDING_UNCERTAIN'
            : 'ONBOARDING_FAILED',
        });
    } else if (name === 'finish_onboarding_request') {
      const session = params.p_session as Row;
      const stored = tables.onboarding_sessions.find(
        (row) => row.workspace_id === workspace,
      );
      const receipt = tables.onboarding_requests.find(
        (row) =>
          row.request_id === params.p_request && row.workspace_id === workspace,
      );
      if (
        !receipt ||
        receipt.status !== 'working' ||
        receipt.execution_token !== params.p_token
      )
        throw Error('TAI:CONFLICT');
      if (!stored || !Array.isArray(stored.messages))
        throw Error('TAI:NOT_FOUND');
      const storedMessages = stored.messages as Row[];
      const prefix = receipt.input_messages as Row[];
      const tail = storedMessages.slice(prefix.length);
      if (
        JSON.stringify((session.messages as Row[]).slice(0, -1)) !==
          JSON.stringify(storedMessages.slice(0, prefix.length)) ||
        (stored.status === 'completed' && session.status !== 'completed')
      )
        throw Error('TAI:CONFLICT');
      if (params.p_identity_changed)
        await apply(
          mocks.db
            .from('business_profile_facts')
            .delete()
            .eq('workspace_id', workspace),
        );
      await apply(
        mocks.db
          .from('business_profiles')
          .upsert(
            { workspace_id: workspace, ...(params.p_profile as Row) },
            { onConflict: 'workspace_id' },
          ),
      );
      for (const fact of params.p_facts as Row[])
        await apply(
          mocks.db
            .from('business_profile_facts')
            .upsert(
              { workspace_id: workspace, ...fact },
              { onConflict: 'workspace_id,field_path' },
            ),
        );
      await apply(
        mocks.db.from('onboarding_sessions').upsert(
          {
            workspace_id: workspace,
            user_id: params.p_user,
            ...(params.p_session as Row),
          },
          { onConflict: 'workspace_id' },
        ),
      );
      await apply(
        mocks.db.from('audit_logs').insert({
          workspace_id: workspace,
          event: 'onboarding.turn_saved',
          metadata: params.p_metadata,
        }),
      );
      (
        tables.onboarding_sessions.find(
          (row) => row.workspace_id === workspace,
        )!.messages as Row[]
      ).push(...tail);
      receipt.status = 'completed';
    } else if (name === 'correct_onboarding_profile') {
      await apply(
        mocks.db
          .from('business_profiles')
          .update(params.p_profile as Row)
          .eq('workspace_id', workspace),
      );
      for (const fact of params.p_facts as Row[])
        await apply(
          mocks.db
            .from('business_profile_facts')
            .upsert(
              { workspace_id: workspace, ...fact },
              { onConflict: 'workspace_id,field_path' },
            ),
        );
      await apply(
        mocks.db.from('audit_logs').insert({
          workspace_id: workspace,
          event: 'onboarding.profile_corrected',
          metadata: params.p_metadata,
        }),
      );
    } else if (name === 'confirm_onboarding') {
      await apply(
        mocks.db
          .from('business_profiles')
          .update({ onboarding_status: 'confirmed' })
          .eq('workspace_id', workspace),
      );
      await apply(
        mocks.db
          .from('business_profile_facts')
          .update({ fact_state: 'confirmed' })
          .eq('workspace_id', workspace),
      );
      await apply(
        mocks.db
          .from('onboarding_sessions')
          .update({ status: 'completed' })
          .eq('workspace_id', workspace),
      );
    } else throw Error(`Unsupported test RPC: ${name}`);
    return { data: null, error: null };
  } catch (error) {
    tables = before;
    return { data: null, error };
  }
}

function queryDb(): SupabaseClient {
  return {
    rpc: async (name: string, params: Row) => {
      if (name === 'consume_rate') {
        rateCalls++;
        return { data: null, error: null };
      }
      return atomicRpc(name, params);
    },
    from: (table: string) => {
      let operation = 'select';
      let fields = '*';
      let value: Row = {};
      let conflict = 'id';
      const filters: ((row: Row) => boolean)[] = [];
      const matches = (row: Row) => filters.every((filter) => filter(row));
      const result = () => {
        const rows = (tables[table] ||= []);
        if (operation !== 'select') {
          writes.push({ table, operation, value: structuredClone(value) });
          if (failWrite?.table === table && failWrite.operation === operation)
            return {
              data: null,
              error: Error('Synthetic injected write failure'),
            };
          if (operation === 'delete')
            tables[table] = rows.filter((row) => !matches(row));
          if (operation === 'update')
            for (const row of rows.filter(matches))
              Object.assign(row, structuredClone(value));
          if (operation === 'insert') rows.push(structuredClone(value));
          if (operation === 'upsert') {
            const keys = conflict.split(',');
            const row = rows.find((item) =>
              keys.every((key) => item[key] === value[key]),
            );
            if (row) Object.assign(row, structuredClone(value));
            else
              rows.push({ id: crypto.randomUUID(), ...structuredClone(value) });
          }
          return { data: null, error: null };
        }
        return {
          data: rows
            .filter(matches)
            .map((row) =>
              structuredClone(
                fields === '*'
                  ? row
                  : Object.fromEntries(
                      fields.split(',').map((field) => [field, row[field]]),
                    ),
              ),
            ),
          error: null,
        };
      };
      const chain = {
        select: (selected: string) => {
          fields = selected;
          return chain;
        },
        eq: (field: string, expected: unknown) => {
          filters.push((row) => row[field] === expected);
          return chain;
        },
        order: () => chain,
        update: (patch: Row) => {
          operation = 'update';
          value = patch;
          return chain;
        },
        insert: (row: Row) => {
          operation = 'insert';
          value = row;
          return chain;
        },
        delete: () => {
          operation = 'delete';
          return chain;
        },
        upsert: (row: Row, options: { onConflict: string }) => {
          operation = 'upsert';
          value = row;
          conflict = options.onConflict;
          return chain;
        },
        single: async () => {
          const found = result();
          return found.data?.length === 1
            ? { data: found.data[0], error: found.error }
            : { data: null, error: Error('Expected exactly one row') };
        },
        maybeSingle: async () => {
          const found = result();
          return (found.data?.length || 0) <= 1
            ? { data: found.data?.[0] || null, error: found.error }
            : { data: null, error: Error('Expected at most one row') };
        },
        // Supabase queries are awaitable. This test fake supports only methods
        // used here; atomic RPC contracts are stubbed separately above.
        // eslint-disable-next-line unicorn/no-thenable -- Models Supabase's awaitable query API.
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (error: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const normalTurn = () => ({
  reply: 'Synthetic saved answer.',
  facts: [
    {
      fieldPath: 'display_name',
      value: 'Synthetic Plumbing',
      confidence: 'high',
      factState: 'owner_supplied',
    },
  ],
  goalsCovered: [],
  nextGoal: 'identity_anchor',
  reviewReady: false,
  identityChanged: false,
  researchUsed: false,
});
function request(path: string, data?: Row, method = 'POST') {
  return onboardingApi(
    new Request(`https://example.test/api/${path}`, {
      method,
      ...(data
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          }
        : {}),
    }),
    path,
    mocks.db,
    userId,
  );
}
function send(
  answer: string,
  requestId = crypto.randomUUID(),
  allowAI = false,
) {
  return request('onboarding/turn', {
    workspaceId,
    requestId,
    answer,
    allowAI,
  });
}
function storedMessages() {
  return tables.onboarding_sessions[0]?.messages as
    | { id: string; role: string; content: string }[]
    | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateCalls = 0;
  writes = [];
  failWrite = undefined;
  tables = {
    workspaces: [
      {
        id: workspaceId,
        name: 'Synthetic Plumbing',
        status: 'active',
        workspace_type: 'business',
        ai_consent_at: '2026-09-01T00:00:00Z',
        time_zone: 'Australia/Sydney',
        created_at: '2026-09-01T00:00:00Z',
      },
    ],
    workspace_members: [
      { workspace_id: workspaceId, user_id: userId, role: 'owner' },
    ],
    onboarding_sessions: [],
    onboarding_requests: [],
    business_profiles: [],
    business_profile_facts: [],
    audit_logs: [],
  };
  mocks.db = queryDb();
  mocks.provider.mockReturnValue({
    model: 'synthetic-test-model',
    attempts: [],
  });
  mocks.magic.mockResolvedValue(normalTurn());
});

describe('independent onboarding API review with explicit storage and AI fakes', () => {
  it('rejects a missing stable request ID before quota, persistence, or provider work', async () => {
    await expect(
      request('onboarding/turn', {
        workspaceId,
        answer: 'Cached client without an ID',
        allowAI: true,
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(rateCalls).toBe(0);
    expect(writes).toEqual([]);
    expect(tables.onboarding_requests).toHaveLength(0);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.magic).not.toHaveBeenCalled();
  });
  it('blocks AI and persistence without consent on an existing unconsented workspace', async () => {
    tables.workspaces[0].ai_consent_at = null;
    await expect(send('Synthetic first answer')).rejects.toMatchObject({
      code: 'AI_CONSENT_REQUIRED',
      status: 403,
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.magic).not.toHaveBeenCalled();
    expect(rateCalls).toBe(0);
    expect(writes).toEqual([]);
  });

  it('rejects a non-owner before consent or AI work', async () => {
    tables.workspace_members[0].role = 'member';
    await expect(
      send('Synthetic member answer', crypto.randomUUID(), true),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(mocks.magic).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('preserves the exact newly failed answer on a later GET before any retry succeeds', async () => {
    const earlier = 'Earlier successful synthetic answer';
    await send(earlier);
    const answer =
      'NEW-FAILED-ANSWER: commercial maintenance at synthetic sites';
    const requestId = crypto.randomUUID();
    mocks.magic.mockRejectedValueOnce(new AppError('AI_TIMEOUT', 503));
    await expect(send(answer, requestId)).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
    });
    const response = await request('onboarding', undefined, 'GET');
    const snapshot = await response!.json();
    expect(snapshot.messages.at(-1)).toMatchObject({
      id: requestId,
      role: 'user',
      content: answer,
    });
    expect(
      storedMessages()?.filter((message) => message.content === answer),
    ).toHaveLength(1);
    expect(
      snapshot.messages.some((message: Row) => message.content === earlier),
    ).toBe(true);
  });

  it('does not regenerate or charge a completed request replay and rejects changed replay text', async () => {
    const requestId = crypto.randomUUID();
    await send('Synthetic saved answer', requestId);
    await send('Synthetic saved answer', requestId);
    expect(mocks.magic).toHaveBeenCalledOnce();
    expect(rateCalls).toBe(1);
    await expect(send('Changed replay text', requestId)).rejects.toMatchObject({
      code: 'ONBOARDING_REQUEST_MISMATCH',
    });
    expect(rateCalls).toBe(1);
  });

  it('preserves existing facts when an identity-change profile write fails', async () => {
    await send('Synthetic old identity');
    const previousFacts = structuredClone(tables.business_profile_facts);
    expect(previousFacts).toHaveLength(1);
    mocks.magic.mockResolvedValueOnce({
      ...normalTurn(),
      identityChanged: true,
      facts: [
        {
          fieldPath: 'display_name',
          value: 'Synthetic New Business',
          confidence: 'high',
          factState: 'owner_supplied',
        },
      ],
    });
    failWrite = { table: 'business_profiles', operation: 'upsert' };
    const failedAnswer = 'Change this workspace to Synthetic New Business';
    await expect(send(failedAnswer)).rejects.toMatchObject({
      code: 'DATABASE_ERROR',
    });
    expect(storedMessages()?.at(-1)?.content).toBe(failedAnswer);
    // Regression invariant: a failed replacement must not discard saved facts.
    expect(tables.business_profile_facts).toEqual(previousFacts);
  });

  it('does not leave the profile confirmed when fact confirmation fails', async () => {
    await send('Synthetic profile to review');
    const previousProfile = structuredClone(tables.business_profiles[0]);
    failWrite = { table: 'business_profile_facts', operation: 'update' };
    await expect(
      request('onboarding/confirm', { workspaceId }),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    expect(tables.business_profiles[0]).toEqual(previousProfile);
  });

  it('keeps profile and facts unchanged when a correction fact write fails', async () => {
    await send('Synthetic profile before correction');
    const previousProfile = structuredClone(tables.business_profiles);
    const previousFacts = structuredClone(tables.business_profile_facts);
    failWrite = { table: 'business_profile_facts', operation: 'upsert' };
    await expect(
      request(
        'onboarding/profile',
        {
          workspaceId,
          facts: [{ fieldPath: 'display_name', value: 'Changed name' }],
        },
        'PATCH',
      ),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR', status: 503 });
    expect(tables.business_profiles).toEqual(previousProfile);
    expect(tables.business_profile_facts).toEqual(previousFacts);
  });

  it('keeps the final value when correction input repeats a field', async () => {
    await send('Synthetic profile before repeated-field correction');
    const rpc = vi.spyOn(mocks.db, 'rpc');
    const response = await request(
      'onboarding/profile',
      {
        workspaceId,
        facts: [
          { fieldPath: 'display_name', value: 'Earlier duplicate' },
          { fieldPath: 'display_name', value: 'Final correction' },
        ],
      },
      'PATCH',
    );
    expect(response?.status).toBe(200);
    expect(tables.business_profiles[0].display_name).toBe('Final correction');
    expect(rpc).toHaveBeenCalledWith(
      'correct_onboarding_profile',
      expect.objectContaining({
        p_facts: [{ field_path: 'display_name', value: 'Final correction' }],
      }),
    );
  });

  it('does not start a second model call for a request ID already processing', async () => {
    let firstStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.magic.mockImplementationOnce(async () => {
      firstStarted();
      await blocked;
      return normalTurn();
    });
    const requestId = crypto.randomUUID();
    const first = send(
      'Synthetic duplicate in-flight request',
      requestId,
    ).catch((error) => error);
    await started; // First handler persisted this request and is inside the AI stub.
    const second = send('Synthetic duplicate in-flight request', requestId);
    try {
      await second;
    } finally {
      release();
      await first;
    }
    // Controlled application request interleaving, not a database race test.
    expect(mocks.magic).toHaveBeenCalledOnce();
    expect(rateCalls).toBe(1);
  });

  it('saves a different overlapping answer and processes it after the first reply without losing either', async () => {
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.magic.mockImplementationOnce(async () => {
      started();
      await barrier;
      return { ...normalTurn(), reply: 'First reply' };
    });
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    const first = send('First saved input', a);
    await entered;
    try {
      const queued = await send('Second saved input', b);
      expect(queued?.status).toBe(202);
      expect(
        storedMessages()
          ?.filter((message) => message.role === 'user')
          .map((message) => message.id),
      ).toEqual([a, b]);
      expect(mocks.magic).toHaveBeenCalledOnce();
    } finally {
      release();
      await first;
    }
    expect(
      storedMessages()
        ?.map((message) => message.content)
        .slice(1),
    ).toEqual(['First saved input', 'First reply', 'Second saved input']);
    expect((await send('Second saved input', b))?.status).toBe(200);
    expect(mocks.magic).toHaveBeenCalledTimes(2);
    expect(rateCalls).toBe(2);
    expect(
      storedMessages()
        ?.map((message) => message.content)
        .slice(1),
    ).toEqual([
      'First saved input',
      'First reply',
      'Second saved input',
      'Synthetic saved answer.',
    ]);
  });

  it('aborts bounded work, retains a terminal receipt, and cannot commit a late result or redispatch the ID', async () => {
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    let suppliedOptions:
      | { signal: AbortSignal; deadlineAt: number }
      | undefined;
    mocks.magic.mockImplementationOnce(async (_provider, _input, options) => {
      suppliedOptions = options;
      started();
      await barrier;
      return normalTurn();
    });
    const id = crypto.randomUUID();
    const before = Date.now();
    const first = onboardingApi(
      new Request('https://example.test/api/onboarding/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          workspaceId,
          requestId: id,
          answer: 'Saved interrupted input',
          allowAI: false,
        }),
      }),
      'onboarding/turn',
      mocks.db,
      userId,
    );
    await entered;
    expect(suppliedOptions?.deadlineAt).toBeGreaterThan(before + 100000);
    expect(suppliedOptions?.deadlineAt).toBeLessThanOrEqual(
      Date.now() + 110000,
    );
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(suppliedOptions?.signal.aborted).toBe(true);
    const replay = await send('Saved interrupted input', id);
    expect(replay?.status).toBe(200);
    expect((await replay!.json()).requests[0]).toMatchObject({
      requestId: id,
      status: 'failed',
      errorCode: 'ONBOARDING_UNCERTAIN',
    });
    release();
    await barrier;
    await Promise.resolve();
    expect(mocks.magic).toHaveBeenCalledOnce();
    expect(rateCalls).toBe(1);
    expect(tables.audit_logs).toHaveLength(0);
    expect(storedMessages()?.at(-1)?.content).toBe('Saved interrupted input');
  });
});

describe('independent memory harness fidelity review', () => {
  it('shows memoryDb.single returns a first row for multiple matches instead of a cardinality error', async () => {
    const fake = memoryDb({ workspaces: [{ id: 'a' }, { id: 'b' }] });
    const result = await fake.db.from('workspaces').select('id').single();
    expect(result).toEqual({ data: { id: 'a' }, count: 2, error: null });
  });

  it('shows memoryDb sorts numeric database columns lexically', async () => {
    const fake = memoryDb({
      records: [
        { id: 'ten', size: 10 },
        { id: 'two', size: 2 },
      ],
    });
    const result = await fake.db
      .from('records')
      .select('id')
      .order('size', { ascending: true });
    expect(result.data).toEqual([{ id: 'ten' }, { id: 'two' }]);
  });
});
