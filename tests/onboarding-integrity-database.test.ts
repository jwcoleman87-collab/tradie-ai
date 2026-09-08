import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { configureTestAccountQuotas } from './fixtures/account-quota-policy';

// Real migrations and PostgreSQL transaction rollback in PGlite. This does not
// exercise the HTTP/authentication boundary or independent SQL connections.
let db: PGlite;
let workspace: string;
const owner = '10000000-0000-4000-8000-000000000001';
const session = '30000000-0000-4000-8000-000000000001';
const submittedAnswer = {
  id: '40000000-0000-4000-8000-000000000001',
  role: 'user',
  content: 'NEWLY-SUBMITTED synthetic business correction',
  createdAt: '2026-09-08T00:00:00Z',
};
const reply = {
  id: '40000000-0000-4000-8000-000000000002',
  role: 'assistant',
  content: 'Synthetic correction saved.',
  createdAt: '2026-09-08T00:00:01Z',
};

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
  await configureTestAccountQuotas(db);
  await db.query('insert into auth.users(id) values($1)', [owner]);
  workspace = await db.transaction(async (tx) => {
    await tx.exec(
      `set local role authenticated;set local "request.jwt.claim.sub"='${owner}';`,
    );
    return (
      await tx.query<{ id: string }>(
        "select bootstrap_workspace('Synthetic Old Business') id",
      )
    ).rows[0].id;
  });
});
beforeEach(async () => {
  await db.exec(
    'truncate public.business_profile_facts,public.onboarding_sessions,public.business_profiles,public.audit_logs',
  );
  await db.query(
    "update workspaces set name='Synthetic Old Business' where id=$1",
    [workspace],
  );
  await db.query(
    "insert into business_profiles(workspace_id,display_name) values($1,'Synthetic Old Business')",
    [workspace],
  );
  await db.query(
    "insert into business_profile_facts(workspace_id,field_path,value,source_type,source_label,confidence,fact_state) values($1,'display_name',$2,'owner_message','Earlier successful turn','high','owner_supplied')",
    [workspace, JSON.stringify('Synthetic Old Business')],
  );
  await db.query(
    'insert into onboarding_sessions(id,user_id,workspace_id,messages) values($1,$2,$3,$4)',
    [session, owner, workspace, JSON.stringify([submittedAnswer])],
  );
});
afterEach(async () => {
  await db.exec(
    'drop trigger if exists review_fault on public.business_profiles;drop trigger if exists review_fault on public.business_profile_facts;drop trigger if exists review_fault on public.audit_logs;drop function if exists public.review_injected_failure()',
  );
});
afterAll(async () => {
  await db.close();
});

async function failWrite(table: string, operation: string) {
  const allowedTables = [
    'business_profiles',
    'business_profile_facts',
    'audit_logs',
  ];
  if (
    !allowedTables.includes(table) ||
    !['insert', 'update'].includes(operation)
  )
    throw Error('Invalid fixture');
  await db.exec(`create function public.review_injected_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic review fault';end$$;
    create trigger review_fault before ${operation} on public.${table} for each row execute function public.review_injected_failure()`);
}
async function snapshot() {
  const result = await db.query<{
    profile: unknown;
    facts: unknown;
    messages: unknown;
    status: unknown;
    audits: unknown;
    session: unknown;
    workspace: unknown;
  }>(
    `select (select to_jsonb(p) from business_profiles p where workspace_id=$1) profile,
      (select jsonb_agg(f order by field_path) from business_profile_facts f where workspace_id=$1) facts,
      (select messages from onboarding_sessions where workspace_id=$1) messages,
      (select status from onboarding_sessions where workspace_id=$1) status,
      (select count(*) from audit_logs where workspace_id=$1) audits,
      (select to_jsonb(s) from onboarding_sessions s where workspace_id=$1) session,
      (select to_jsonb(w) from workspaces w where id=$1) workspace`,
    [workspace],
  );
  return result.rows[0];
}
async function commit(status = 'review', priorMessages = [submittedAnswer]) {
  return db.query('select commit_onboarding_turn($1,$2,$3,$4,$5,$6,$7)', [
    workspace,
    owner,
    JSON.stringify({
      display_name: 'Synthetic New Business',
      onboarding_status: status,
      updated_at: reply.createdAt,
    }),
    JSON.stringify({
      id: session,
      messages: [...priorMessages, reply],
      information_goals: ['identity_anchor'],
      current_goal: 'preferred_work',
      unresolved_questions: [],
      discovery_status: 'unavailable',
      prompt_count: 1,
      status: status === 'confirmed' ? 'completed' : status,
      updated_at: reply.createdAt,
    }),
    JSON.stringify([
      {
        field_path: 'display_name',
        value: 'Synthetic New Business',
        source_type: 'owner_message',
        source_label: 'Current synthetic turn',
        source_url: 'owner://synthetic',
        confidence: 'high',
        fact_state: 'owner_supplied',
        observed_at: reply.createdAt,
      },
    ]),
    true,
    JSON.stringify({ identity_changed: true }),
  ]);
}

async function correct() {
  return db.query('select correct_onboarding_profile($1,$2,$3,$4,$5)', [
    workspace,
    owner,
    JSON.stringify({
      display_name: 'Synthetic Corrected Business',
      updated_at: reply.createdAt,
    }),
    JSON.stringify([
      { field_path: 'display_name', value: 'Synthetic Corrected Business' },
    ]),
    JSON.stringify({ fields: ['display_name'] }),
  ]);
}

it('atomically commits the changed identity, facts, answer, reply and audit', async () => {
  await commit();
  const saved = await snapshot();
  expect(saved.profile).toMatchObject({
    display_name: 'Synthetic New Business',
    onboarding_status: 'review',
  });
  expect(saved.facts).toEqual([
    expect.objectContaining({ value: 'Synthetic New Business' }),
  ]);
  expect(saved.messages).toEqual([submittedAnswer, reply]);
  expect(saved.audits).toBe(1);
});
it.each(['business_profiles', 'business_profile_facts', 'audit_logs'])(
  'rolls back changed identity and preserves the actual submitted answer when %s fails',
  async (table) => {
    const before = await snapshot();
    await failWrite(table, table === 'business_profiles' ? 'update' : 'insert');
    await expect(commit()).rejects.toThrow('synthetic review fault');
    expect(await snapshot()).toEqual(before);
    expect((await snapshot()).messages).toEqual([submittedAnswer]);
  },
);
it('confirms profile, facts, session and workspace name together', async () => {
  await commit();
  await db.query('select confirm_onboarding($1,$2)', [workspace, owner]);
  expect(await snapshot()).toMatchObject({
    profile: { onboarding_status: 'confirmed' },
    status: 'completed',
    facts: [expect.objectContaining({ fact_state: 'confirmed' })],
  });
  expect(
    (
      await db.query<{ name: string }>(
        'select name from workspaces where id=$1',
        [workspace],
      )
    ).rows[0].name,
  ).toBe('Synthetic New Business');
});
it.each(['business_profile_facts', 'audit_logs'])(
  'leaves all confirmation state unchanged when %s fails',
  async (table) => {
    const before = await snapshot();
    await failWrite(table, table === 'audit_logs' ? 'insert' : 'update');
    await expect(
      db.query('select confirm_onboarding($1,$2)', [workspace, owner]),
    ).rejects.toThrow('synthetic review fault');
    expect(await snapshot()).toEqual(before);
  },
);
it('atomically applies a profile correction and its fact provenance and audit', async () => {
  await correct();
  expect(await snapshot()).toMatchObject({
    profile: { display_name: 'Synthetic Corrected Business' },
    facts: [
      expect.objectContaining({
        value: 'Synthetic Corrected Business',
        source_type: 'owner_correction',
      }),
    ],
    audits: 1,
  });
});
it.each(['business_profile_facts', 'audit_logs'])(
  'preserves profile, facts and audit when a correction %s write fails',
  async (table) => {
    const before = await snapshot();
    await failWrite(table, 'insert');
    await expect(correct()).rejects.toThrow('synthetic review fault');
    expect(await snapshot()).toEqual(before);
  },
);
it('refuses a stale reply when a newer reply has changed the saved transcript', async () => {
  await commit();
  const newer = await snapshot();
  await expect(commit()).rejects.toThrow('TAI:CONFLICT');
  expect(await snapshot()).toEqual(newer);
});
it('does not reopen a confirmed profile when a pre-confirmation reply arrives', async () => {
  await db.query('select confirm_onboarding($1,$2)', [workspace, owner]);
  const confirmed = await snapshot();
  await expect(commit()).rejects.toThrow('TAI:CONFLICT');
  expect(await snapshot()).toEqual(confirmed);
});
it('uses confirmed profile state even when an older pre-model write regressed session status', async () => {
  await db.query('select confirm_onboarding($1,$2)', [workspace, owner]);
  await db.query(
    "update onboarding_sessions set status='in_progress' where id=$1",
    [session],
  );
  const before = await snapshot();
  await expect(commit()).rejects.toThrow('TAI:CONFLICT');
  expect(await snapshot()).toEqual(before);
});
it('continues a confirmed setup without losing its confirmed timestamp', async () => {
  await commit();
  await db.query('select confirm_onboarding($1,$2)', [workspace, owner]);
  const continued = [
    submittedAnswer,
    reply,
    {
      ...submittedAnswer,
      id: crypto.randomUUID(),
      content: 'Synthetic post-confirmation follow-up',
    },
  ];
  await db.query('update onboarding_sessions set messages=$1 where id=$2', [
    JSON.stringify(continued),
    session,
  ]);
  await commit('confirmed', continued);
  expect(await snapshot()).toMatchObject({
    profile: {
      onboarding_status: 'confirmed',
      confirmed_at: expect.any(String),
    },
    status: 'completed',
    messages: [...continued, reply],
  });
});
it('denies a foreign actor and withholds all onboarding RPCs from browser roles', async () => {
  const before = await snapshot();
  await expect(
    db.query('select confirm_onboarding($1,$2)', [
      workspace,
      crypto.randomUUID(),
    ]),
  ).rejects.toThrow('TAI:FORBIDDEN');
  const privileges = await db.query<{
    proname: string;
    anon: boolean;
    authenticated: boolean;
    service: boolean;
  }>(
    `select proname,has_function_privilege('anon',oid,'execute') anon,
      has_function_privilege('authenticated',oid,'execute') authenticated,
      has_function_privilege('service_role',oid,'execute') service
    from pg_proc where proname in ('commit_onboarding_turn','confirm_onboarding','correct_onboarding_profile')`,
  );
  expect(privileges.rows).toHaveLength(3);
  expect(
    privileges.rows.every(
      (row) => !row.anon && !row.authenticated && row.service,
    ),
  ).toBe(true);
  expect(await snapshot()).toEqual(before);
});
