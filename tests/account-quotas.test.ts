import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  testAccountQuotaPolicy,
  configureTestAccountQuotas,
} from './fixtures/account-quota-policy';
import { parseAccountQuotaPolicy } from '../lib/server/account-quota-policy.mjs';
import { configureAccountQuotas } from '../scripts/configure-account-quotas.mjs';
import { rpc } from '../lib/server/db';

let db: PGlite;
const id = () => crypto.randomUUID();
const zero = Object.fromEntries(
  Object.keys(testAccountQuotaPolicy).map((key) => [key, 0]),
);
type Workspace = { user: string; workspace: string; conversation: string };
async function call<T = Record<string, unknown>>(
  name: string,
  params: unknown[],
) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (
      await tx.query<{ value: T }>(
        `select public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) value`,
        params,
      )
    ).rows[0].value;
  });
}
async function configure(changes: Partial<typeof testAccountQuotaPolicy> = {}) {
  await call('configure_account_quotas', [
    JSON.stringify({ ...testAccountQuotaPolicy, ...changes }),
  ]);
}
async function owner() {
  const user = id();
  await db.query('insert into auth.users(id) values($1)', [user]);
  return user;
}
async function workspace(user = ''): Promise<Workspace> {
  user ||= await owner();
  const w = await call<string>('create_workspace', [
    'Synthetic quota test',
    user,
  ]);
  await db.query('update workspaces set ai_consent_at=now() where id=$1', [w]);
  return {
    user,
    workspace: w,
    conversation: (
      await db.query<{ id: string }>(
        'select id from conversations where workspace_id=$1',
        [w],
      )
    ).rows[0].id,
  };
}
async function start(
  t: Workspace,
  request = id(),
  text = 'Synthetic accepted request',
) {
  return call('begin_chat', [
    t.workspace,
    t.conversation,
    t.user,
    request,
    text,
    [],
  ]);
}
async function finish(run: Record<string, unknown>) {
  await call('complete_chat', [
    run.id,
    'Synthetic completed reply',
    [],
    [],
    'synthetic',
    [],
  ]);
}
async function count(user: string, operation = 'chat') {
  return (
    await db.query<{ count: number }>(
      'select count(*)::integer count from account_ai_requests where user_id=$1 and operation=$2',
      [user, operation],
    )
  ).rows[0].count;
}
async function bootstrap(user: string, omitName = false) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    return (
      await tx.query<{ id: string }>(
        omitName
          ? 'select bootstrap_workspace() id'
          : "select bootstrap_workspace('Synthetic bootstrap') id",
      )
    ).rows[0].id;
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;
    grant select on storage.objects to authenticated;grant all on storage.objects,storage.buckets to service_role;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort())
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
});
beforeEach(async () => {
  await configureTestAccountQuotas(db);
  // Avoid a fixed-minute boundary bisecting an assertion. No production clock
  // or function is mocked; reset tests explicitly change synthetic receipts.
  const remaining = 60000 - (Date.now() % 60000);
  if (remaining < 1500)
    await new Promise((resolve) => setTimeout(resolve, remaining + 10));
});
afterAll(async () => {
  await db.close();
});

describe('account quota configuration', () => {
  it('fails closed before accepting work when a required policy field is missing', async () => {
    const t = await workspace();
    const fresh = await owner();
    await db.exec('update account_quota_policy set chat_daily=null');
    await expect(start(t)).rejects.toThrow('QUOTA_CONFIG_INVALID');
    await expect(
      call('create_workspace', ['Missing policy', fresh]),
    ).rejects.toThrow('QUOTA_CONFIG_INVALID');
    await expect(bootstrap(fresh, true)).rejects.toThrow(
      'QUOTA_CONFIG_INVALID',
    );
    expect(await count(t.user)).toBe(0);
    expect(
      (await db.query('select id from agent_runs where user_id=$1', [t.user]))
        .rows,
    ).toEqual([]);
    expect(
      (
        await db.query('select id from workspaces where personal_owner=$1', [
          fresh,
        ])
      ).rows,
    ).toEqual([]);
  });

  it.each([
    {},
    { ...testAccountQuotaPolicy, unknown: 1 },
    { ...testAccountQuotaPolicy, chat_daily: -1 },
    { ...testAccountQuotaPolicy, chat_daily: 1.5 },
    { ...testAccountQuotaPolicy, chat_daily: '10' },
    { ...testAccountQuotaPolicy, chat_daily: 2147483648 },
    { ...testAccountQuotaPolicy, chat_daily: null },
  ])('rejects invalid full-policy updates atomically: %j', async (invalid) => {
    const before = (await db.query('select * from account_quota_policy')).rows;
    await expect(
      call('configure_account_quotas', [JSON.stringify(invalid)]),
    ).rejects.toThrow('QUOTA_CONFIG_INVALID');
    expect((await db.query('select * from account_quota_policy')).rows).toEqual(
      before,
    );
  });

  it('keeps policy configuration, reads and receipt writes unavailable to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          return tx.query('select configure_account_quotas($1)', [
            JSON.stringify(zero),
          ]);
        }),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          return tx.query('select * from account_ai_requests');
        }),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('supports explicit zero for every ceiling without an implicit unlimited fallback', async () => {
    await call('configure_account_quotas', [JSON.stringify(zero)]);
    const user = await owner();
    for (let n = 0; n < 21; n++) {
      const t = await workspace(user);
      await start(t);
      await call('consume_account_ai_quota', [user, 'onboarding', id()]);
    }
    expect(await count(user)).toBe(21);
    expect(await count(user, 'onboarding')).toBe(21);
    expect(
      (
        await db.query<{ count: number }>(
          'select count(*)::integer count from workspaces where personal_owner=$1',
          [user],
        )
      ).rows[0].count,
    ).toBe(21);
  });
});

describe('account-wide accepted Chat and onboarding requests', () => {
  it('shares Chat burst capacity across workspaces, preserves account independence and replay identity', async () => {
    await configure({ chat_burst: 2 });
    const user = await owner();
    const a = await workspace(user),
      b = await workspace(user),
      other = await workspace();
    const request = id();
    const first = await start(a, request);
    await finish(first);
    const second = await start(b);
    await finish(second);
    await expect(start(a)).rejects.toThrow('CHAT_BURST_LIMIT');
    expect(await count(user)).toBe(2);
    expect(await start(a, request)).toMatchObject({
      id: first.id,
      existing: true,
    });
    await expect(start(b, request)).rejects.toThrow('CONFLICT');
    expect(await count(user)).toBe(2);
    await expect(start(other)).resolves.toMatchObject({ existing: false });
  });

  it('keeps the daily Chat ceiling after a minute reset, then resets at the UTC day boundary', async () => {
    await configure({ chat_burst: 1, chat_daily: 1 });
    const t = await workspace();
    await finish(await start(t));
    await configure({ chat_burst: 0, chat_daily: 1 });
    await db.query(
      "update account_ai_requests set accepted_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' where user_id=$1",
      [t.user],
    );
    await expect(start(t)).rejects.toThrow('CHAT_DAILY_LIMIT');
    expect(await count(t.user)).toBe(1);
    await db.query(
      "update account_ai_requests set accepted_at=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where user_id=$1",
      [t.user],
    );
    await expect(start(t)).resolves.toMatchObject({ existing: false });
    expect(await count(t.user)).toBe(2);
  });

  it('reserves Chat slots across workspaces, releases only terminal or expired work and leaves rejected inputs uncharged', async () => {
    await configure({ chat_concurrency: 1 });
    const user = await owner();
    const a = await workspace(user),
      b = await workspace(user);
    const first = await start(a);
    await expect(start(b)).rejects.toThrow('CHAT_CONCURRENCY_LIMIT');
    expect(await count(user)).toBe(1);
    await finish(first);
    const second = await start(b);
    await expect(start(a)).rejects.toThrow('CHAT_CONCURRENCY_LIMIT');
    await db.query(
      "update agent_runs set status='failed',error_code='SYNTHETIC_PROVIDER_FAILURE',finished_at=now() where id=$1",
      [second.id],
    );
    const third = await start(a);
    await expect(start(b)).rejects.toThrow('CHAT_CONCURRENCY_LIMIT');
    await db.query(
      "update agent_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [third.id],
    );
    await expect(start(b)).resolves.toMatchObject({ existing: false });
    expect(await count(user)).toBe(4);
    // These state transitions establish SQL slot accounting, not that a live
    // provider has stopped. Runtime cancellation has separate integration tests.
  });

  it('rejects archived containers without charging or creating runs', async () => {
    const a = await workspace(),
      b = await workspace();
    await call('set_conversation_status', [
      a.workspace,
      a.conversation,
      a.user,
      'archived',
    ]);
    await call('set_workspace_status', [b.workspace, b.user, 'archived']);
    await expect(start(a)).rejects.toThrow('CONVERSATION_ARCHIVED');
    await expect(start(b)).rejects.toThrow('WORKSPACE_ARCHIVED');
    expect(await count(a.user)).toBe(0);
    expect(await count(b.user)).toBe(0);
  });

  it('charges an accepted onboarding ID only once and shares burst/day limits across the account', async () => {
    await configure({ onboarding_burst: 1, onboarding_daily: 1 });
    const user = await owner(),
      other = await owner(),
      request = id();
    await call('consume_account_ai_quota', [user, 'onboarding', request]);
    await call('consume_account_ai_quota', [user, 'onboarding', request]);
    await expect(
      call('consume_account_ai_quota', [user, 'onboarding', id()]),
    ).rejects.toThrow('ONBOARDING_BURST_LIMIT');
    expect(await count(user, 'onboarding')).toBe(1);
    await call('consume_account_ai_quota', [other, 'onboarding', request]);
    await configure({ onboarding_burst: 0, onboarding_daily: 1 });
    await db.query(
      "update account_ai_requests set accepted_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' where user_id=$1",
      [user],
    );
    await expect(
      call('consume_account_ai_quota', [user, 'onboarding', id()]),
    ).rejects.toThrow('ONBOARDING_DAILY_LIMIT');
    await db.query(
      "update account_ai_requests set accepted_at=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where user_id=$1",
      [user],
    );
    await call('consume_account_ai_quota', [user, 'onboarding', id()]);
    expect(await count(user, 'onboarding')).toBe(2);
  });

  it('rolls back a quota reservation when its enclosing accepted-claim transaction fails', async () => {
    const user = await owner();
    await expect(
      db.transaction(async (tx) => {
        await tx.query("select consume_account_ai_quota($1,'onboarding',$2)", [
          user,
          id(),
        ]);
        await tx.exec(
          "do $$begin raise exception 'synthetic later claim failure';end$$",
        );
      }),
    ).rejects.toThrow('synthetic later claim failure');
    expect(await count(user, 'onboarding')).toBe(0);
  });
});

describe('workspace account capacity and optional RPC shapes', () => {
  it('terminalizes an expired working claim when archiving and fences its old execution token', async () => {
    const t = await workspace();
    const request = id();
    const accepted = await call('accept_onboarding_request', [
      t.workspace,
      t.user,
      request,
      'Synthetic expired answer',
      true,
      'Synthetic opening',
      'unavailable',
    ]);
    expect(accepted.dispatch).toBe(true);
    await db.query(
      "update onboarding_requests set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=$1 and request_id=$2",
      [t.user, request],
    );
    await call('set_workspace_status', [t.workspace, t.user, 'archived']);
    expect(
      (
        await db.query(
          'select status,error_code from onboarding_requests where user_id=$1 and request_id=$2',
          [t.user, request],
        )
      ).rows,
    ).toEqual([{ status: 'failed', error_code: 'ONBOARDING_UNCERTAIN' }]);
    await expect(
      call('finish_onboarding_request', [
        t.workspace,
        t.user,
        request,
        accepted.token,
        '{}',
        '{}',
        '[]',
        false,
        '{}',
      ]),
    ).rejects.toThrow('CONFLICT');
    expect(
      (
        await db.query(
          'select workspace_id from business_profiles where workspace_id=$1',
          [t.workspace],
        )
      ).rows,
    ).toEqual([]);
  });

  it('enforces active, total including archived, and daily creation independently', async () => {
    const user = await owner();
    await configure({
      workspace_active: 1,
      workspace_total: 2,
      workspace_daily: 2,
    });
    const a = await workspace(user);
    await expect(workspace(user)).rejects.toThrow('WORKSPACE_ACTIVE_LIMIT');
    await call('set_workspace_status', [a.workspace, user, 'archived']);
    const b = await workspace(user);
    await expect(
      call('set_workspace_status', [a.workspace, user, 'active']),
    ).rejects.toThrow('WORKSPACE_ACTIVE_LIMIT');
    await call('set_workspace_status', [b.workspace, user, 'archived']);
    await expect(workspace(user)).rejects.toThrow('WORKSPACE_TOTAL_LIMIT');
    await configure({
      workspace_active: 1,
      workspace_total: 0,
      workspace_daily: 2,
    });
    await expect(workspace(user)).rejects.toThrow('WORKSPACE_DAILY_LIMIT');
    await call('set_workspace_status', [a.workspace, user, 'active']);
    expect(await bootstrap(user, true)).toBe(a.workspace);
    await call('set_workspace_status', [a.workspace, user, 'archived']);
    await db.query(
      "update workspaces set created_at=clock_timestamp()-interval '1 day' where personal_owner=$1",
      [user],
    );
    await expect(workspace(user)).resolves.toHaveProperty('workspace');
    await expect(workspace()).resolves.toHaveProperty('workspace');
  });

  it('defaulted browser bootstrap is configured and idempotent even when all workspaces are archived', async () => {
    await configure({
      workspace_active: 1,
      workspace_total: 1,
      workspace_daily: 1,
    });
    const user = await owner();
    const w = await bootstrap(user, true);
    expect(await bootstrap(user)).toBe(w);
    await call('set_workspace_status', [w, user, 'archived']);
    expect(await bootstrap(user, true)).toBe(w);
    await expect(
      call('create_workspace', ['No optional type', user]),
    ).rejects.toThrow('WORKSPACE_TOTAL_LIMIT');
    expect(
      (
        await db.query('select id from workspaces where personal_owner=$1', [
          user,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it.each(['queued', 'working', 'uncertain'])(
    'keeps accepted %s onboarding work from being archived until terminal or expired',
    async (state) => {
      const t = await workspace();
      const request = id();
      const accepted = await call('accept_onboarding_request', [
        t.workspace,
        t.user,
        request,
        'Synthetic durable setup answer',
        true,
        'Synthetic opening',
        'unavailable',
      ]);
      expect(accepted.dispatch).toBe(true);
      if (state === 'queued')
        await db.query(
          "update onboarding_requests set status='queued' where user_id=$1 and request_id=$2",
          [t.user, request],
        );
      if (state === 'uncertain')
        await db.query(
          "update onboarding_requests set status='failed',error_code='ONBOARDING_UNCERTAIN' where user_id=$1 and request_id=$2",
          [t.user, request],
        );
      await expect(
        call('set_workspace_status', [t.workspace, t.user, 'archived']),
      ).rejects.toThrow('ACTIVE_WORK_REMAINS');
      expect(
        (
          await db.query<{ status: string }>(
            'select status from workspaces where id=$1',
            [t.workspace],
          )
        ).rows[0].status,
      ).toBe('active');
      await db.query(
        "update onboarding_requests set status='failed',error_code='ONBOARDING_UNCERTAIN',lease_expires_at=clock_timestamp()-interval '1 second' where user_id=$1 and request_id=$2",
        [t.user, request],
      );
      await call('set_workspace_status', [t.workspace, t.user, 'archived']);
      expect(
        (
          await db.query<{ status: string }>(
            'select status from workspaces where id=$1',
            [t.workspace],
          )
        ).rows[0].status,
      ).toBe('archived');
    },
  );
});

describe('deployment configuration validation and customer reset metadata', () => {
  const environment = {
    ACCOUNT_CHAT_DAILY_LIMIT: '10',
    ACCOUNT_CHAT_CONCURRENCY_LIMIT: '2',
    ACCOUNT_ONBOARDING_DAILY_LIMIT: '10',
    ACCOUNT_WORKSPACE_TOTAL_LIMIT: '30',
    ACCOUNT_WORKSPACE_DAILY_LIMIT: '3',
  };
  it('requires new explicit values, retains existing defaults, and accepts explicit zero', () => {
    expect(() => parseAccountQuotaPolicy({})).toThrow('QUOTA_CONFIG_INVALID');
    expect(parseAccountQuotaPolicy(environment)).toMatchObject({
      chat_burst: 12,
      onboarding_burst: 10,
      workspace_active: 20,
    });
    expect(
      parseAccountQuotaPolicy({ ...environment, ACCOUNT_CHAT_DAILY_LIMIT: '0' })
        .chat_daily,
    ).toBe(0);
    for (const value of [
      '',
      '-1',
      '1.2',
      'Infinity',
      'NaN',
      '2147483648',
      '1e3',
    ])
      expect(() =>
        parseAccountQuotaPolicy({
          ...environment,
          ACCOUNT_CHAT_DAILY_LIMIT: value,
        }),
      ).toThrow('QUOTA_CONFIG_INVALID');
  });
  it('validates all configuration before any setup network/write call', async () => {
    const fetcher = vi.fn();
    await expect(
      configureAccountQuotas({ environment: {}, apply: true, fetcher }),
    ).rejects.toThrow('QUOTA_CONFIG_INVALID');
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await configureAccountQuotas({ environment, fetcher }),
    ).toMatchObject({ validated: true, applied: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns bounded reset metadata only when supplied by a known SQL quota failure', async () => {
    const fake = {
      rpc: async () => ({
        data: null,
        error: {
          message: 'TAI:CHAT_DAILY_LIMIT',
          details: '{"retryAfterSeconds":123}',
        },
      }),
    } as unknown as SupabaseClient;
    await expect(rpc(fake, 'begin_chat', {})).rejects.toMatchObject({
      code: 'CHAT_DAILY_LIMIT',
      status: 429,
      retryAfterSeconds: 123,
    });
  });
});
