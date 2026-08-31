import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

let db: PGlite, wA: string, wB: string, cA: string, cB: string;
const ownerA = '10000000-0000-4000-8000-000000000001',
  ownerB = '10000000-0000-4000-8000-000000000002',
  member = '10000000-0000-4000-8000-000000000003',
  support = '10000000-0000-4000-8000-000000000004';
const id = () => crypto.randomUUID();
async function asUser<T>(user: string, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec(
      `set local role authenticated;set local "request.jwt.claim.sub"='${user}';`,
    );
    return (await tx.query<T>(sql, params)).rows;
  });
}
async function call<T = Record<string, unknown>>(
  name: string,
  params: unknown[] = [],
) {
  const row = (
    await db.query<{ value: T }>(
      `select public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) as value`,
      params,
    )
  ).rows[0];
  return row.value;
}
async function proposal(extra: { expired?: boolean; calendar?: boolean } = {}) {
  const actionId = id();
  await db.query(
    `insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload,expires_at) values($1,$2,$3,'maintenance',$4,'Save record',$5,$6)`,
    [
      actionId,
      wA,
      cA,
      extra.calendar ? 'calendar.create' : 'record.create',
      JSON.stringify({
        kind: 'asset',
        title: 'Honda engine',
        body: 'Last service at 250 hours, current hours 312.',
      }),
      new Date(
        Date.now() + (extra.expired ? -86400000 : 86400000),
      ).toISOString(),
    ],
  );
  return actionId;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant select on storage.objects to authenticated;grant all on storage.objects,storage.buckets to service_role;`);
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort())
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  for (const user of [ownerA, ownerB, member, support])
    await db.query('insert into auth.users(id) values($1)', [user]);
  wA = (
    await asUser<{ id: string }>(
      ownerA,
      "select bootstrap_workspace('Business A') id",
    )
  )[0].id;
  wB = (
    await asUser<{ id: string }>(
      ownerB,
      "select bootstrap_workspace('Business B') id",
    )
  )[0].id;
  cA = (
    await db.query<{ id: string }>(
      'select id from conversations where workspace_id=$1',
      [wA],
    )
  ).rows[0].id;
  cB = (
    await db.query<{ id: string }>(
      'select id from conversations where workspace_id=$1',
      [wB],
    )
  ).rows[0].id;
  await db.query("insert into workspace_members values($1,$2,'member')", [
    wA,
    member,
  ]);
  await db.query('insert into support_operators values($1)', [support]);
});
afterAll(async () => {
  await db.close();
});

describe('migrations and tenant security on real PostgreSQL', () => {
  it('enables RLS on every application table', async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
    );
    expect(tables.rows.length).toBeGreaterThan(15);
    expect(tables.rows.every((r) => r.relrowsecurity)).toBe(true);
  });
  it('bootstraps idempotently with one private owner workspace', async () =>
    expect(
      (
        await asUser<{ id: string }>(
          ownerA,
          "select bootstrap_workspace('Again') id",
        )
      )[0].id,
    ).toBe(wA));
  it('cannot read another customer workspace', async () => {
    expect(
      await asUser(ownerA, 'select * from workspaces where id=$1', [wB]),
    ).toEqual([]);
    expect(
      await asUser(ownerA, 'select * from conversations where id=$1', [cB]),
    ).toEqual([]);
  });
  it('cannot change membership or impersonate an owner', async () => {
    await expect(
      asUser(ownerA, "insert into workspace_members values($1,$2,'owner')", [
        wB,
        ownerA,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(
        member,
        "update workspace_members set role='owner' where user_id=$1",
        [member],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
  it('browser callers cannot write operational tables or invoke privileged RPCs', async () => {
    for (const table of [
      'messages',
      'proposed_actions',
      'action_approvals',
      'audit_logs',
      'business_records',
      'integration_credentials',
      'oauth_states',
      'support_operators',
    ])
      expect(
        (
          await asUser<{ allowed: boolean }>(
            ownerA,
            "select has_table_privilege(current_user,$1,'INSERT') allowed",
            [`public.${table}`],
          )
        )[0].allowed,
      ).toBe(false);
    for (const fn of [
      'decide_action(uuid,uuid,text)',
      'claim_action(uuid,uuid)',
      'finish_action(uuid,uuid,jsonb,text)',
      'complete_chat(uuid,text,jsonb,jsonb,text,jsonb)',
    ])
      expect(
        (
          await asUser<{ allowed: boolean }>(
            ownerA,
            "select has_function_privilege(current_user,$1,'EXECUTE') allowed",
            [`public.${fn}`],
          )
        )[0].allowed,
      ).toBe(false);
  });
  it('credentials are unreadable to customers and support', async () => {
    await expect(
      asUser(ownerA, 'select * from integration_credentials'),
    ).rejects.toThrow(/permission denied/i);
    await expect(asUser(support, 'select * from oauth_states')).rejects.toThrow(
      /permission denied/i,
    );
  });
  it('enforces storage read policies independently of UI filters', async () => {
    const file = id(),
      path = `${wB}/${file}/invoice.pdf`;
    await db.query(
      "insert into uploaded_files(id,workspace_id,conversation_id,uploaded_by,filename,object_path,mime_type,size_bytes,sha256,status) values($1,$2,$3,$4,'invoice.pdf',$5,'application/pdf',10,'hash','ready')",
      [file, wB, cB, ownerB, path],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('workspace-files',$1)",
      [path],
    );
    expect(
      await asUser(ownerA, 'select * from storage.objects where name=$1', [
        path,
      ]),
    ).toEqual([]);
    expect(
      await asUser(ownerB, 'select * from storage.objects where name=$1', [
        path,
      ]),
    ).toHaveLength(1);
  });
});
describe('approval and execution state machine', () => {
  it('does not execute a pending or denied action', async () => {
    const a = await proposal();
    await expect(call('claim_action', [a, ownerA])).rejects.toThrow('CONFLICT');
    await call('decide_action', [a, ownerA, 'deny']);
    await expect(call('claim_action', [a, ownerA])).rejects.toThrow('CONFLICT');
  });
  it('rejects foreign owners and non-approver members', async () => {
    const a = await proposal();
    for (const u of [ownerB, member])
      await expect(call('decide_action', [a, u, 'accept'])).rejects.toThrow(
        'FORBIDDEN',
      );
  });
  it('expires without approving or executing', async () => {
    const a = await proposal({ expired: true });
    const r = await call('decide_action', [a, ownerA, 'accept']);
    expect(r.status).toBe('expired');
    expect(
      (await db.query('select * from action_approvals where action_id=$1', [a]))
        .rows,
    ).toHaveLength(0);
  });
  it('records approval once, locks execution, and saves a record once', async () => {
    const a = await proposal();
    await call('decide_action', [a, ownerA, 'accept']);
    await call('decide_action', [a, ownerA, 'accept']);
    expect(
      (await db.query('select * from action_approvals where action_id=$1', [a]))
        .rows,
    ).toHaveLength(1);
    const first = await call<{ claimed: boolean; token: string }>(
      'claim_action',
      [a, ownerA],
    );
    expect(first.claimed).toBe(true);
    expect((await call('claim_action', [a, ownerA])).claimed).toBe(false);
    await expect(call('finish_action', [a, id(), {}, null])).rejects.toThrow(
      'CONFLICT',
    );
    await call('finish_action', [a, first.token, { recordId: a }, null]);
    expect((await call('claim_action', [a, ownerA])).claimed).toBe(false);
    expect(
      (await db.query('select * from business_records where action_id=$1', [a]))
        .rows,
    ).toHaveLength(1);
    await expect(call('decide_action', [a, ownerA, 'deny'])).rejects.toThrow(
      'CONFLICT',
    );
  });
  it('makes the reviewed payload immutable', async () => {
    const a = await proposal();
    await expect(
      db.query("update proposed_actions set payload='{}' where id=$1", [a]),
    ).rejects.toThrow('IMMUTABLE');
  });
  it('records failure and opens one private linked case', async () => {
    const a = await proposal();
    await call('decide_action', [a, ownerA, 'accept']);
    let claim = await call<{ token: string }>('claim_action', [a, ownerA]);
    await call('finish_action', [a, claim.token, null, 'TEST_FAILURE']);
    claim = await call<{ token: string }>('claim_action', [a, ownerA]);
    await call('finish_action', [a, claim.token, null, 'TEST_FAILURE']);
    const rows = (
      await db.query<{ shared_with_support: boolean }>(
        'select * from escalation_cases where action_id=$1',
        [a],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].shared_with_support).toBe(false);
  });
  it('recovers a stale execution lease without reapproval', async () => {
    const a = await proposal();
    await call('decide_action', [a, ownerA, 'accept']);
    const first = await call<{ token: string }>('claim_action', [a, ownerA]);
    await db.query(
      "update proposed_actions set lease_until=now()-interval '1 minute' where id=$1",
      [a],
    );
    const second = await call<{ token: string; claimed: boolean }>(
      'claim_action',
      [a, ownerA],
    );
    expect(second.claimed).toBe(true);
    expect(second.token).not.toBe(first.token);
    await expect(
      call('finish_action', [a, first.token, {}, null]),
    ).rejects.toThrow('CONFLICT');
  });
  it('requires the exact connected calendar before approval', async () => {
    const a = await proposal({ calendar: true });
    await expect(call('decide_action', [a, ownerA, 'accept'])).rejects.toThrow(
      'CONNECTION_CHANGED',
    );
  });
  it('keeps audit and approval receipts append-only', async () => {
    await expect(
      db.query("update audit_logs set event='hidden' where workspace_id=$1", [
        wA,
      ]),
    ).rejects.toThrow('IMMUTABLE');
    await expect(db.exec('delete from action_approvals')).rejects.toThrow(
      'IMMUTABLE',
    );
  });
});
describe('chat transaction and escalation privacy', () => {
  it('requires AI consent before processing', async () =>
    await expect(
      call('begin_chat', [wA, cA, ownerA, id(), 'hello', []]),
    ).rejects.toThrow('CONSENT_REQUIRED'));
  it('deduplicates a chat request and atomically persists its result', async () => {
    await db.query('update workspaces set ai_consent_at=now() where id=$1', [
      wA,
    ]);
    const request = id();
    const params = [wA, cA, ownerA, request, 'Record service hours', []];
    const r = await call<{ id: string }>('begin_chat', params);
    expect((await call('begin_chat', params)).existing).toBe(true);
    await expect(
      call('begin_chat', [wA, cA, ownerA, id(), 'second', []]),
    ).rejects.toThrow('BUSY');
    await call('complete_chat', [
      r.id,
      'Draft ready',
      ['maintenance'],
      [
        {
          agent: 'maintenance',
          version: '1.0.0',
          sha256: 'a'.repeat(64),
          path: 'skills/maintenance/SKILL.md',
        },
      ],
      'mock-test',
      [],
    ]);
    expect(
      (await db.query('select * from messages where run_id=$1', [r.id])).rows,
    ).toHaveLength(2);
    expect((await call('begin_chat', params)).status).toBe('completed');
    await expect(
      call('complete_chat', [r.id, 'Duplicate', [], [], 'mock-test', []]),
    ).rejects.toThrow('CONFLICT');
  });
  it('rejects cross-tenant conversations and attachments', async () => {
    await expect(
      call('begin_chat', [wA, cB, ownerA, id(), 'hello', []]),
    ).rejects.toThrow('NOT_FOUND');
    const f = (
      await db.query<{ id: string }>(
        'select id from uploaded_files where workspace_id=$1',
        [wB],
      )
    ).rows[0].id;
    await expect(
      call('begin_chat', [wA, cA, ownerA, id(), 'hello', [f]]),
    ).rejects.toThrow('FORBIDDEN');
  });
  it('rate limits on durable database counters', async () => {
    for (let i = 0; i < 3; i++)
      await call('consume_rate', [wA, ownerA, 'test', 3]);
    await expect(call('consume_rate', [wA, ownerA, 'test', 3])).rejects.toThrow(
      'RATE_LIMITED',
    );
  });
  it('shares only categorical support data with a permanent Case ID', async () => {
    const c = await call<{ id: string; case_id: string }>('create_case', [
      wA,
      cA,
      ownerA,
      'finance',
      'general',
      'Jane Smith, 15 Main Road, bank secret 123456',
      true,
    ]);
    expect(c.case_id).toMatch(/^CASE-\d+$/);
    const rows = await asUser<{ payload: unknown }>(
      support,
      'select * from support_cases where case_id=$1',
      [c.case_id],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Jane|Main Road|123456/);
    expect(
      await asUser(support, 'select * from escalation_cases where id=$1', [
        c.id,
      ]),
    ).toEqual([]);
    expect(await asUser(ownerB, 'select * from support_cases')).toEqual([]);
    await call('resolve_case', [
      c.id,
      ownerA,
      'Private solution Jane',
      'Private outcome 123456',
    ]);
    const closed = (
      await asUser<{ solution: string; outcome: string }>(
        ownerA,
        'select * from escalation_cases where id=$1',
        [c.id],
      )
    )[0];
    expect(closed.solution).toContain('Jane');
    expect(closed.outcome).toContain('123456');
    expect(
      JSON.stringify(
        await asUser(support, 'select * from support_cases where case_id=$1', [
          c.case_id,
        ]),
      ),
    ).not.toMatch(/Jane|123456/);
  });
  it('binds OAuth state to cookie, owner and expiry and consumes it once', async () => {
    await db.query(
      "insert into oauth_states(state_hash,cookie_hash,workspace_id,user_id,verifier) values('state','cookie',$1,$2,'pkce')",
      [wA, ownerA],
    );
    await expect(
      call('consume_oauth_state', ['state', 'wrong']),
    ).rejects.toThrow('FORBIDDEN');
    expect(
      (await call('consume_oauth_state', ['state', 'cookie'])).workspace_id,
    ).toBe(wA);
    await expect(
      call('consume_oauth_state', ['state', 'cookie']),
    ).rejects.toThrow('FORBIDDEN');
  });
});
