import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { configureTestAccountQuotas } from './fixtures/account-quota-policy';

// Real PostgreSQL migration/transaction semantics, single PGlite connection.
// Independent connection blocking is proved by native-onboarding-claims.mjs.
let db: PGlite;
let workspace: string;
const owner = '11000000-0000-4000-8000-000000000001';
type Claim = {
  dispatch: boolean;
  status: string;
  token: string;
  session: Record<string, unknown> & { messages: unknown[] };
  profile: unknown;
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
        "select bootstrap_workspace('Synthetic Claims') id",
      )
    ).rows[0].id;
  });
});
beforeEach(async () => {
  await db.exec(
    'truncate onboarding_requests,account_ai_requests,business_profile_facts,onboarding_sessions,business_profiles,audit_logs',
  );
  await configureTestAccountQuotas(db);
  await db.query('update workspaces set ai_consent_at=null where id=$1', [
    workspace,
  ]);
});
afterAll(async () => {
  await db.close();
});
async function accept(
  id: string,
  answer = 'Synthetic saved answer',
  allowAI = true,
) {
  return (
    await db.query<{ claim: Claim }>(
      'select accept_onboarding_request($1,$2,$3,$4,$5,$6,$7) claim',
      [
        workspace,
        owner,
        id,
        answer,
        allowAI,
        'Synthetic opening',
        'unavailable',
      ],
    )
  ).rows[0].claim;
}
function finish(id: string, claim: Claim, token = claim.token) {
  const now = new Date().toISOString();
  const reply = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: `Reply to ${id}`,
    createdAt: now,
  };
  return db.query(
    'select finish_onboarding_request($1,$2,$3,$4,$5,$6,$7,false,$8)',
    [
      workspace,
      owner,
      id,
      token,
      JSON.stringify({
        display_name: 'Synthetic Claims',
        onboarding_status: 'review',
        updated_at: now,
      }),
      JSON.stringify({
        ...claim.session,
        messages: [...claim.session.messages, reply],
        status: 'review',
        updated_at: now,
      }),
      JSON.stringify([
        {
          field_path: 'display_name',
          value: 'Synthetic Claims',
          source_type: 'owner_message',
          source_label: 'Synthetic input',
          confidence: 'high',
          fact_state: 'owner_supplied',
          observed_at: now,
        },
      ]),
      '{}',
    ],
  );
}
async function counts() {
  return (
    await db.query<{
      charges: number;
      requests: number;
      audits: number;
    }>(`select
    (select count(*)::int from account_ai_requests) charges,
    (select count(*)::int from onboarding_requests) requests,
    (select count(*)::int from audit_logs where event='onboarding.turn_saved') audits`)
  ).rows[0];
}
async function messages() {
  return (
    await db.query<{
      messages: { id: string; role: string; content: string }[];
    }>('select messages from onboarding_sessions where workspace_id=$1', [
      workspace,
    ])
  ).rows[0].messages;
}
it('accepts and charges one exact payload once; inflight/completed replays cannot dispatch', async () => {
  const id = crypto.randomUUID();
  const claim = await accept(id);
  expect(claim.dispatch).toBe(true);
  expect(await accept(id)).toEqual({ dispatch: false, status: 'working' });
  await expect(accept(id, 'Changed payload')).rejects.toThrow(
    'ONBOARDING_REQUEST_MISMATCH',
  );
  await expect(accept(id, 'Synthetic saved answer', false)).rejects.toThrow(
    'ONBOARDING_REQUEST_MISMATCH',
  );
  expect(await counts()).toEqual({ charges: 1, requests: 1, audits: 0 });
  await finish(id, claim);
  expect(await accept(id)).toEqual({ dispatch: false, status: 'completed' });
  await expect(finish(id, claim)).rejects.toThrow('CONFLICT');
  expect(await counts()).toEqual({ charges: 1, requests: 1, audits: 1 });
  expect(
    (await messages()).filter((message) => message.id === id),
  ).toHaveLength(1);
});
it('durably queues distinct answers and inserts each reply before the later queued answer without losing either', async () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID(),
    c = crypto.randomUUID();
  const claimA = await accept(a, 'First answer');
  expect(await accept(b, 'Second answer')).toEqual({
    dispatch: false,
    status: 'queued',
  });
  expect(await accept(c, 'Third answer')).toEqual({
    dispatch: false,
    status: 'queued',
  });
  expect(
    (await messages())
      .filter((message) => message.role === 'user')
      .map((message) => message.id),
  ).toEqual([a, b, c]);
  await finish(a, claimA);
  expect(await accept(c, 'Third answer')).toEqual({
    dispatch: false,
    status: 'queued',
  });
  const claimB = await accept(b, 'Second answer');
  expect(claimB.dispatch).toBe(true);
  expect(claimB.session.messages).toHaveLength(4);
  await finish(b, claimB);
  await finish(c, await accept(c, 'Third answer'));
  expect((await messages()).map((message) => message.content)).toEqual([
    'Synthetic opening',
    'First answer',
    `Reply to ${a}`,
    'Second answer',
    `Reply to ${b}`,
    'Third answer',
    `Reply to ${c}`,
  ]);
  expect(await counts()).toEqual({ charges: 3, requests: 3, audits: 3 });
});
it('keeps an uncertain lease occupied, never redispatches it, and rejects its fenced completion after expiry', async () => {
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const claim = await accept(a);
  await db.query('select fail_onboarding_request($1,$2,$3,$4,true)', [
    workspace,
    owner,
    a,
    claim.token,
  ]);
  expect(await accept(a)).toEqual({ dispatch: false, status: 'failed' });
  expect(await accept(b, 'Later answer')).toEqual({
    dispatch: false,
    status: 'queued',
  });
  await expect(finish(a, claim)).rejects.toThrow('CONFLICT');
  // Explicit clock fault injection; does not pretend a real 150s elapsed.
  await db.query(
    "update onboarding_requests set lease_expires_at=clock_timestamp()-interval '1 second' where request_id=$1",
    [a],
  );
  expect((await accept(b, 'Later answer')).dispatch).toBe(true);
  expect(await accept(a)).toEqual({ dispatch: false, status: 'failed' });
  expect(await counts()).toEqual({ charges: 2, requests: 2, audits: 0 });
});
it('expires a crashed working receipt terminally and rejects incorrect tokens and elapsed absolute deadlines', async () => {
  const id = crypto.randomUUID();
  const claim = await accept(id);
  await expect(finish(id, claim, crypto.randomUUID())).rejects.toThrow(
    'CONFLICT',
  );
  await db.query(
    "update onboarding_requests set deadline_at=clock_timestamp()-interval '1 second' where request_id=$1",
    [id],
  );
  await expect(finish(id, claim)).rejects.toThrow('CONFLICT');
  await db.query(
    "update onboarding_requests set lease_expires_at=clock_timestamp()-interval '1 second' where request_id=$1",
    [id],
  );
  expect(await accept(id)).toEqual({ dispatch: false, status: 'failed' });
  expect(await counts()).toEqual({ charges: 1, requests: 1, audits: 0 });
});
it('rejects missing consent before quota, and quota rejection rolls back consent/input/receipt', async () => {
  await expect(
    accept(crypto.randomUUID(), 'No consent', false),
  ).rejects.toThrow('AI_CONSENT_REQUIRED');
  await db.exec('update account_quota_policy set onboarding_daily=null');
  await expect(accept(crypto.randomUUID())).rejects.toThrow(
    'QUOTA_CONFIG_INVALID',
  );
  expect(await counts()).toEqual({ charges: 0, requests: 0, audits: 0 });
  expect(
    (
      await db.query('select ai_consent_at from workspaces where id=$1', [
        workspace,
      ])
    ).rows[0],
  ).toEqual({ ai_consent_at: null });
  expect(
    (await db.query('select * from onboarding_sessions')).rows,
  ).toHaveLength(0);
});
it('rolls back reply/profile/facts/audit/receipt completion together on a downstream fault', async () => {
  const id = crypto.randomUUID(),
    claim = await accept(id);
  const before = await messages();
  await db.exec(`create function claim_fault() returns trigger language plpgsql as $$begin raise exception 'synthetic fault';end$$;
    create trigger claim_fault before insert on audit_logs for each row execute function claim_fault();`);
  try {
    await expect(finish(id, claim)).rejects.toThrow('synthetic fault');
  } finally {
    await db.exec(
      'drop trigger claim_fault on audit_logs;drop function claim_fault()',
    );
  }
  expect(await messages()).toEqual(before);
  expect((await db.query('select * from business_profiles')).rows).toHaveLength(
    0,
  );
  expect(
    (await db.query('select * from business_profile_facts')).rows,
  ).toHaveLength(0);
  expect(await accept(id)).toEqual({ dispatch: false, status: 'working' });
  expect(await counts()).toEqual({ charges: 1, requests: 1, audits: 0 });
});
it('does not apply a model result over a profile changed after dispatch', async () => {
  const id = crypto.randomUUID(),
    claim = await accept(id);
  await db.query(
    "insert into business_profiles(workspace_id,display_name) values($1,'Concurrent correction')",
    [workspace],
  );
  await expect(finish(id, claim)).rejects.toThrow('CONFLICT');
  expect(
    (await db.query('select display_name from business_profiles')).rows,
  ).toEqual([{ display_name: 'Concurrent correction' }]);
  expect(await counts()).toEqual({ charges: 1, requests: 1, audits: 0 });
});
