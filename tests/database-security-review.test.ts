import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rpc } from '../lib/server/db';

// Runs the actual migrations in PGlite. This is SQL/RLS evidence, not an HTTP,
// Supabase-auth, storage-download, or independent-connection race test.
let db: PGlite;
const id = () => crypto.randomUUID();
type Tenant = {
  user: string;
  workspace: string;
  conversation: string;
  file: string;
  path: string;
  action: string;
  record: string;
};
const tenants: Tenant[] = [];

async function roleQuery<T = Record<string, unknown>>(
  role: 'authenticated' | 'anon' | 'service_role',
  user: string | null,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user || '',
    ]);
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function call<T = Record<string, unknown>>(
  name: string,
  params: unknown[],
) {
  return (
    await roleQuery<{ value: T }>(
      'service_role',
      null,
      `select public.${name}(${params.map((_, index) => `$${index + 1}`).join(',')}) value`,
      params,
    )
  )[0].value;
}

async function owner() {
  const user = id();
  await db.query('insert into auth.users(id) values($1)', [user]);
  return user;
}

async function workspace(user: string, name = 'Synthetic review business') {
  // Deliberately exercise the old two-argument RPC shape, defaulting type.
  const workspaceId = await call<string>('create_workspace', [name, user]);
  await db.query('update workspaces set ai_consent_at=now() where id=$1', [
    workspaceId,
  ]);
  const conversation = (
    await db.query<{ id: string }>(
      'select id from conversations where workspace_id=$1',
      [workspaceId],
    )
  ).rows[0].id;
  return { workspace: workspaceId, conversation, user };
}

async function conversation(t: Pick<Tenant, 'workspace' | 'user'>) {
  return (
    await db.query<{ id: string }>(
      'insert into conversations(workspace_id,created_by) values($1,$2) returning id',
      [t.workspace, t.user],
    )
  ).rows[0].id;
}

async function proposal(t: Pick<Tenant, 'workspace' | 'conversation'>) {
  const action = id();
  await db.query(
    "insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload) values($1,$2,$3,'maintenance','record.create','Synthetic approved record',$4)",
    [
      action,
      t.workspace,
      t.conversation,
      {
        kind: 'note',
        title: 'Private synthetic record',
        body: `Private content ${t.workspace}`,
      },
    ],
  );
  return action;
}

const tenantTables = [
  'workspace_members',
  'conversations',
  'agent_runs',
  'messages',
  'proposed_actions',
  'action_approvals',
  'action_executions',
  'uploaded_files',
  'business_records',
  'escalation_cases',
  'case_events',
  'audit_logs',
  'business_profiles',
  'business_profile_facts',
  'onboarding_sessions',
];

async function tenantSnapshot(t: Tenant) {
  const result: Record<string, unknown> = {};
  for (const table of ['workspaces', ...tenantTables, 'rate_limits']) {
    const key = table === 'workspaces' ? 'id' : 'workspace_id';
    result[table] = (
      await db.query<{ value: unknown }>(
        `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from public.${table} t where ${key}=$1`,
        [t.workspace],
      )
    ).rows[0].value;
  }
  return result;
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
  for (const label of ['A', 'B']) {
    const base = await workspace(await owner(), `Synthetic tenant ${label}`);
    const file = id();
    const path = `${base.workspace}/${file}/private-${label}.pdf`;
    await db.query(
      "insert into uploaded_files(id,workspace_id,conversation_id,uploaded_by,filename,object_path,mime_type,size_bytes,sha256,status) values($1,$2,$3,$4,$5,$6,'application/pdf',100,$7,'ready')",
      [
        file,
        base.workspace,
        base.conversation,
        base.user,
        `private-${label}.pdf`,
        path,
        'a'.repeat(64),
      ],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('workspace-files',$1)",
      [path],
    );
    const action = await proposal(base);
    await call('decide_action', [action, base.user, 'accept']);
    const claim = await call('claim_action', [action, base.user]);
    await call('finish_action', [action, claim.token, { saved: true }, null]);
    const run = await call('begin_chat', [
      base.workspace,
      base.conversation,
      base.user,
      id(),
      `Private synthetic message ${label}`,
      [file],
    ]);
    await call('complete_chat', [
      run.id,
      `Private synthetic reply ${label}`,
      [],
      [],
      'synthetic',
      [],
    ]);
    await call('create_case', [
      base.workspace,
      base.conversation,
      base.user,
      'maintenance',
      'missing_information',
      `Private synthetic case ${label}`,
      true,
    ]);
    await db.query(
      'insert into business_profiles(workspace_id,display_name) values($1,$2)',
      [base.workspace, `Private profile ${label}`],
    );
    await db.query(
      "insert into business_profile_facts(workspace_id,field_path,value,source_type,source_label,confidence,fact_state) values($1,'display_name',$2,'owner_message','Synthetic fixture','high','owner_supplied')",
      [base.workspace, JSON.stringify(`Private fact ${label}`)],
    );
    await db.query(
      'insert into onboarding_sessions(workspace_id,user_id,messages) values($1,$2,$3)',
      [
        base.workspace,
        base.user,
        [{ id: id(), role: 'user', content: `Private onboarding ${label}` }],
      ],
    );
    tenants.push({ ...base, file, path, action, record: action });
  }
});

afterAll(async () => {
  await db.close();
});

describe('independent SQL/RLS review in PGlite', () => {
  it('has RLS and no browser mutation grants on every public application table', async () => {
    const tables = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
      )
    ).rows;
    expect(tables.length).toBeGreaterThanOrEqual(25);
    for (const table of tables) {
      expect(table.relrowsecurity, table.relname).toBe(true);
      for (const role of ['anon', 'authenticated'] as const) {
        const grants = await roleQuery<{ allowed: boolean }>(
          role,
          tenants[0].user,
          "select has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed",
          [`public.${table.relname}`],
        );
        expect(grants[0].allowed, `${role}: ${table.relname}`).toBe(false);
      }
    }
  });

  it('keeps every non-trigger privileged function server-only, including default-parameter overloads', async () => {
    const functions = (
      await db.query<{ name: string; signature: string }>(
        "select proname name,oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and prorettype<>'trigger'::regtype",
      )
    ).rows;
    expect(functions.length).toBeGreaterThan(20);
    for (const fn of functions) {
      for (const role of ['anon', 'authenticated'] as const) {
        const allowed =
          role === 'authenticated' &&
          ['bootstrap_workspace', 'is_member', 'is_support_operator'].includes(
            fn.name,
          );
        expect(
          (
            await roleQuery<{ allowed: boolean }>(
              role,
              tenants[0].user,
              "select has_function_privilege(current_user,$1,'EXECUTE') allowed",
              [fn.signature],
            )
          )[0].allowed,
          `${role}: ${fn.signature}`,
        ).toBe(allowed);
      }
    }
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        roleQuery(role, tenants[0].user, 'select consume_rate($1,$2,$3,$4)', [
          tenants[0].workspace,
          tenants[0].user,
          'chat',
          999999,
        ]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        roleQuery(role, tenants[0].user, 'select create_workspace($1,$2)', [
          'Unauthorised',
          tenants[0].user,
        ]),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  for (const [ownIndex, foreignIndex] of [
    [0, 1],
    [1, 0],
  ]) {
    it(`reads populated private resources only for their owner, direction ${ownIndex} to ${foreignIndex}`, async () => {
      const own = tenants[ownIndex],
        foreign = tenants[foreignIndex];
      for (const table of ['workspaces', ...tenantTables]) {
        const key = table === 'workspaces' ? 'id' : 'workspace_id';
        // The exact foreign resource is first positively verified as its owner.
        const foreignRows = await roleQuery(
          'authenticated',
          foreign.user,
          `select * from ${table} where ${key}=$1`,
          [foreign.workspace],
        );
        expect(
          foreignRows.length,
          `${table} fixture is populated`,
        ).toBeGreaterThan(0);
        const denied = await roleQuery(
          'authenticated',
          own.user,
          `select * from ${table} where ${key}=$1`,
          [foreign.workspace],
        );
        expect(denied, table).toEqual([]);
      }
      expect(
        await roleQuery(
          'authenticated',
          foreign.user,
          'select * from storage.objects where name=$1',
          [foreign.path],
        ),
      ).toHaveLength(1);
      expect(
        await roleQuery(
          'authenticated',
          own.user,
          'select * from storage.objects where name=$1',
          [foreign.path],
        ),
      ).toEqual([]);
    });

    it(`denies foreign RPC writes, approval, execution and attachment without mutation, direction ${ownIndex} to ${foreignIndex}`, async () => {
      const actor = tenants[ownIndex],
        foreign = tenants[foreignIndex];
      // Positive controls use the exact same owner-checked RPCs, not direct writes.
      await call('update_workspace', [
        foreign.workspace,
        foreign.user,
        'Renamed synthetic business',
        'business',
      ]);
      await call('set_record_status', [
        foreign.workspace,
        foreign.record,
        foreign.user,
        'archived',
      ]);
      await call('set_record_status', [
        foreign.workspace,
        foreign.record,
        foreign.user,
        'active',
      ]);
      await call('set_conversation_status', [
        foreign.workspace,
        foreign.conversation,
        foreign.user,
        'archived',
      ]);
      await call('set_conversation_status', [
        foreign.workspace,
        foreign.conversation,
        foreign.user,
        'active',
      ]);
      await call('set_workspace_status', [
        foreign.workspace,
        foreign.user,
        'archived',
      ]);
      await call('set_workspace_status', [
        foreign.workspace,
        foreign.user,
        'active',
      ]);
      expect(
        await call('decide_action', [foreign.action, foreign.user, 'accept']),
      ).toMatchObject({ status: 'completed' });
      expect(
        await call('claim_action', [foreign.action, foreign.user]),
      ).toMatchObject({ claimed: false });
      const before = await tenantSnapshot(foreign);
      for (const [name, args] of [
        [
          'update_workspace',
          [foreign.workspace, actor.user, 'Stolen name', 'business'],
        ],
        ['set_workspace_status', [foreign.workspace, actor.user, 'archived']],
        [
          'set_conversation_status',
          [foreign.workspace, foreign.conversation, actor.user, 'archived'],
        ],
        [
          'set_record_status',
          [foreign.workspace, foreign.record, actor.user, 'archived'],
        ],
        ['decide_action', [foreign.action, actor.user, 'accept']],
        ['claim_action', [foreign.action, actor.user]],
        [
          'begin_chat',
          [
            foreign.workspace,
            foreign.conversation,
            actor.user,
            id(),
            'Foreign message',
            [],
          ],
        ],
        ['consume_rate', [foreign.workspace, actor.user, 'chat', 12]],
      ] as [string, unknown[]][]) {
        await expect(call(name, args), name).rejects.toThrow('FORBIDDEN');
        expect(await tenantSnapshot(foreign), name).toEqual(before);
      }
      // Positive-control attachment is persisted by the actual begin_chat RPC.
      const request = id();
      const run = await call('begin_chat', [
        actor.workspace,
        actor.conversation,
        actor.user,
        request,
        'Owner attachment',
        [actor.file],
      ]);
      await call('complete_chat', [
        run.id,
        'Attachment accepted',
        [],
        [],
        'synthetic',
        [],
      ]);
      const actorBefore = await tenantSnapshot(actor);
      await expect(
        call('begin_chat', [
          actor.workspace,
          actor.conversation,
          actor.user,
          id(),
          'Foreign attachment',
          [foreign.file],
        ]),
      ).rejects.toThrow('FORBIDDEN');
      expect(await tenantSnapshot(actor)).toEqual(actorBefore);
      expect(await tenantSnapshot(foreign)).toEqual(before);
    });
  }

  it('denies browser reads of credential/counter tables and writes leave counters unchanged', async () => {
    const t = tenants[0];
    await db.query(
      "insert into integration_credentials(workspace_id,encrypted_refresh_token,connected_by,provider) values($1,'synthetic-ciphertext',$2,'google_calendar')",
      [t.workspace, t.user],
    );
    expect(
      (
        await roleQuery(
          'service_role',
          null,
          'select * from integration_credentials where workspace_id=$1',
          [t.workspace],
        )
      ).length,
    ).toBe(1);
    const before = await tenantSnapshot(t);
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of [
        'integration_credentials',
        'integration_candidates',
        'oauth_states',
        'integration_generations',
        'external_publish_attempts',
        'rate_limits',
      ]) {
        await expect(
          roleQuery(role, t.user, `select * from ${table}`),
        ).rejects.toThrow(/permission denied/i);
      }
      await expect(
        roleQuery(
          role,
          t.user,
          'update rate_limits set requests=0 where workspace_id=$1',
          [t.workspace],
        ),
      ).rejects.toThrow(/permission denied/i);
    }
    expect(await tenantSnapshot(t)).toEqual(before);
  });
});

describe('configured limits and request accounting in PGlite', () => {
  it('deduplicates chat without another charge and conflicts do not mutate persisted work', async () => {
    const t = await workspace(await owner());
    const request = id();
    const args = [
      t.workspace,
      t.conversation,
      t.user,
      request,
      'Original request',
      [],
    ];
    const first = await call('begin_chat', args);
    expect(await call('begin_chat', args)).toMatchObject({
      id: first.id,
      existing: true,
    });
    await expect(
      call('begin_chat', [
        t.workspace,
        t.conversation,
        t.user,
        request,
        'Changed request',
        [],
      ]),
    ).rejects.toThrow('CONFLICT');
    await expect(
      call('begin_chat', [
        t.workspace,
        t.conversation,
        t.user,
        id(),
        'Another request',
        [],
      ]),
    ).rejects.toThrow('BUSY');
    expect(
      (
        await db.query(
          'select requests from rate_limits where workspace_id=$1 and operation=$2',
          [t.workspace, 'chat'],
        )
      ).rows,
    ).toEqual([{ requests: 1 }]);
    expect(
      (
        await db.query('select content from messages where run_id=$1', [
          first.id,
        ])
      ).rows,
    ).toEqual([{ content: 'Original request' }]);
    // Omitted optional usage/trace use the protected modern complete_chat wrapper.
    await call('complete_chat', [first.id, 'Done', [], [], 'synthetic', []]);
    expect(await call('begin_chat', args)).toMatchObject({
      id: first.id,
      status: 'completed',
      existing: true,
    });
    expect(
      (
        await db.query(
          'select requests from rate_limits where workspace_id=$1 and operation=$2',
          [t.workspace, 'chat'],
        )
      ).rows,
    ).toEqual([{ requests: 1 }]);
  });

  it('enforces chat 12/minute and onboarding 10/minute with rollback and fixed-minute reset', async () => {
    const t = await workspace(await owner());
    // Keep all checks in one transaction so crossing a wall-clock minute cannot
    // make this deterministic counter-boundary test flaky.
    await db.transaction(async (tx) => {
      for (const [operation, limit] of [
        ['chat', 12],
        ['onboarding', 10],
      ] as const) {
        for (let count = 0; count < limit; count++)
          await tx.query('select consume_rate($1,$2,$3,$4)', [
            t.workspace,
            t.user,
            operation,
            limit,
          ]);
        await tx.exec('savepoint rejected_limit');
        await expect(
          tx.query('select consume_rate($1,$2,$3,$4)', [
            t.workspace,
            t.user,
            operation,
            limit,
          ]),
        ).rejects.toThrow('RATE_LIMITED');
        await tx.exec('rollback to savepoint rejected_limit');
        expect(
          (
            await tx.query(
              'select requests from rate_limits where workspace_id=$1 and operation=$2',
              [t.workspace, operation],
            )
          ).rows,
        ).toEqual([{ requests: limit }]);
        await tx.query(
          "update rate_limits set window_start=date_trunc('minute',now())-interval '1 minute' where workspace_id=$1 and operation=$2",
          [t.workspace, operation],
        );
        await tx.query('select consume_rate($1,$2,$3,$4)', [
          t.workspace,
          t.user,
          operation,
          limit,
        ]);
        expect(
          (
            await tx.query(
              'select requests from rate_limits where workspace_id=$1 and operation=$2',
              [t.workspace, operation],
            )
          ).rows,
        ).toEqual([{ requests: 1 }]);
      }
    });
  });

  it('documents baseline accounting scope: separate workspaces and conversations accept simultaneous unfinished work', async () => {
    const user = await owner();
    const a = await workspace(user),
      b = await workspace(user),
      other = await workspace(await owner());
    // This deliberately records existing behavior, not a proposed account limit.
    for (const t of [a, b, other]) {
      for (let request = 0; request < 3; request++) {
        await call('begin_chat', [
          t.workspace,
          await conversation(t),
          t.user,
          id(),
          'Unfinished synthetic work',
          [],
        ]);
      }
    }
    expect(
      (
        await db.query(
          'select count(*)::integer count from agent_runs where user_id=$1 and status=$2',
          [user, 'working'],
        )
      ).rows,
    ).toEqual([{ count: 6 }]);
    expect(
      (
        await db.query(
          'select requests from rate_limits where user_id=$1 and operation=$2 order by workspace_id',
          [user, 'chat'],
        )
      ).rows,
    ).toEqual([{ requests: 3 }, { requests: 3 }]);
    expect(
      (
        await db.query(
          'select count(*)::integer count from agent_runs where user_id=$1 and status=$2',
          [other.user, 'working'],
        )
      ).rows,
    ).toEqual([{ count: 3 }]);
  });

  it('applies the existing 20-active-workspace ceiling to restoring archived workspaces', async () => {
    const user = await owner();
    const first = await workspace(user);
    await call('set_workspace_status', [first.workspace, user, 'archived']);
    for (let count = 0; count < 20; count++) await workspace(user);
    await expect(
      call('create_workspace', ['Over limit', user]),
    ).rejects.toThrow('WORKSPACE_LIMIT');
    await expect(
      call('set_workspace_status', [first.workspace, user, 'active']),
    ).rejects.toThrow('WORKSPACE_LIMIT');
    expect(
      (
        await db.query(
          'select count(*)::integer count from workspaces where personal_owner=$1 and status=$2',
          [user, 'active'],
        )
      ).rows,
    ).toEqual([{ count: 20 }]);
    expect(
      (
        await db.query('select status from workspaces where id=$1', [
          first.workspace,
        ])
      ).rows,
    ).toEqual([{ status: 'archived' }]);
  });

  it('explains how workspace capacity is freed without promising a timed reset', async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: { message: 'TAI:WORKSPACE_LIMIT' },
      }),
    } as unknown as SupabaseClient;
    await expect(rpc(client, 'create_workspace', {})).rejects.toMatchObject({
      code: 'WORKSPACE_LIMIT',
      status: 429,
      message:
        'This account has 20 active workspaces. Archive a workspace before creating or restoring another.',
    });
  });
});
