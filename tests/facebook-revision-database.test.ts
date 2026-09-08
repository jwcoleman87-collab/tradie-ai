import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Action } from '../lib/contracts';
import { configureTestAccountQuotas } from './fixtures/account-quota-policy';

let db: PGlite;
const owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  member = crypto.randomUUID();
let workspace: string;
const id = () => crypto.randomUUID();
async function call<T = Record<string, unknown>>(
  name: string,
  params: unknown[] = [],
) {
  return (
    await db.query<{ value: T }>(
      `select public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) value`,
      params,
    )
  ).rows[0].value;
}
async function connection(pageId = '12345') {
  const candidate = id(),
    connectionId = id();
  await db.query(
    "insert into integration_candidates(id,workspace_id,user_id,provider,ciphertext,generation) values($1,$2,$3,'facebook','encrypted',$4)",
    [
      candidate,
      workspace,
      owner,
      await call('lock_integration_generation', [workspace, 'facebook']),
    ],
  );
  await call('complete_provider_connection', [
    candidate,
    owner,
    connectionId,
    'encrypted',
    pageId,
    'Selected Page',
    ['pages_manage_posts'],
    {},
  ]);
  return connectionId;
}
async function proposal(
  options: { expired?: boolean; image?: boolean; privateDraft?: boolean } = {},
) {
  const conversationId = (
    await db.query<{ id: string }>(
      'insert into conversations(workspace_id,created_by) values($1,$2) returning id',
      [workspace, owner],
    )
  ).rows[0].id;
  const actionId = id(),
    connectionId = await connection(),
    imageId = options.image ? id() : null;
  if (imageId)
    await db.query(
      "insert into uploaded_files(id,workspace_id,conversation_id,uploaded_by,filename,object_path,mime_type,size_bytes,sha256,status) values($1,$2,$3,$4,'site.jpg',$5,'image/jpeg',100,'hash','ready')",
      [
        imageId,
        workspace,
        conversationId,
        owner,
        `${workspace}/${imageId}/site.jpg`,
      ],
    );
  return (
    await db.query<Action>(
      'insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload,connection_id,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
      [
        actionId,
        workspace,
        conversationId,
        'social',
        options.privateDraft ? 'draft.save' : 'facebook.publish',
        'Exact caption',
        options.privateDraft
          ? { kind: 'social', title: 'Draft', body: 'Private draft' }
          : {
              pageId: '12345',
              message: 'Original caption',
              imageFileId: imageId,
              link: null,
            },
        options.privateDraft ? null : connectionId,
        new Date(
          Date.now() + (options.expired ? -3600000 : 3600000),
        ).toISOString(),
      ],
    )
  ).rows[0];
}
const revise = (
  action: Action,
  message = 'Edited caption',
  link: string | null = null,
  user = owner,
) => call<Action>('revise_facebook_action', [action.id, user, message, link]);

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
  await configureTestAccountQuotas(db);
  await db.query('insert into auth.users(id) values($1),($2),($3)', [
    owner,
    other,
    member,
  ]);
  workspace = await call<string>('create_workspace', [
    'Revision fixtures',
    owner,
    'sandbox',
  ]);
  await db.query(
    "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
    [workspace, member],
  );
});
afterAll(async () => {
  await db.close();
});

it('preserves the reviewed destination and photo while requiring fresh approval of edited content', async () => {
  const action = await proposal({ image: true });
  const replacement = await revise(action);
  expect(replacement).toMatchObject({
    status: 'waiting_approval',
    connection_id: action.connection_id,
    conversation_id: action.conversation_id,
    summary: action.summary,
    payload: { ...action.payload, message: 'Edited caption' },
    replaces_action_id: action.id,
    approved_by: null,
    approved_at: null,
    attempts: 0,
    execution_result: null,
  });
  expect(new Date(replacement.expires_at).getTime()).toBe(
    new Date(action.expires_at).getTime(),
  );
  const original = (
    await db.query<Action>('select * from proposed_actions where id=$1', [
      action.id,
    ])
  ).rows[0];
  expect(original).toMatchObject({
    status: 'superseded',
    superseded_by: replacement.id,
    payload: action.payload,
  });
  await expect(
    call('decide_action', [action.id, owner, 'accept']),
  ).rejects.toThrow('CONFLICT');
  await expect(call('claim_action', [replacement.id, owner])).rejects.toThrow(
    'CONFLICT',
  );
  await call('decide_action', [replacement.id, owner, 'accept']);
  expect((await call('claim_action', [replacement.id, owner])).claimed).toBe(
    true,
  );
});

it('returns one successor on identical retries and refuses a different stale edit', async () => {
  const action = await proposal();
  const first = await revise(
    action,
    'Final caption',
    'https://example.test/job',
  );
  expect(
    (await revise(action, 'Final caption', 'https://example.test/job')).id,
  ).toBe(first.id);
  await expect(revise(action, 'Stale caption')).rejects.toThrow('CONFLICT');
  expect(
    (
      await db.query(
        'select id from proposed_actions where replaces_action_id=$1',
        [action.id],
      )
    ).rows,
  ).toHaveLength(1);
  const latest = await revise(first, 'Newest caption');
  await expect(
    revise(action, 'Final caption', 'https://example.test/job'),
  ).rejects.toThrow('CONFLICT');
  expect(latest.status).toBe('waiting_approval');
});

it('rejects old edit retries after the replacement is approved', async () => {
  const action = await proposal(),
    replacement = await revise(action);
  await call('decide_action', [replacement.id, owner, 'accept']);
  await expect(revise(action)).rejects.toThrow('CONFLICT');
});

it.each(['approved', 'denied', 'cancelled'] as const)(
  'cannot edit %s work',
  async (status) => {
    const action = await proposal();
    if (status === 'cancelled') await call('cancel_action', [action.id, owner]);
    else
      await call('decide_action', [
        action.id,
        owner,
        status === 'approved' ? 'accept' : 'deny',
      ]);
    await expect(revise(action)).rejects.toThrow('CONFLICT');
  },
);

it('rejects expired proposals and private drafts', async () => {
  await expect(revise(await proposal({ expired: true }))).rejects.toThrow(
    'EXPIRED',
  );
  await expect(revise(await proposal({ privateDraft: true }))).rejects.toThrow(
    'CONFLICT',
  );
});

it('refuses non-owner edits', async () => {
  const action = await proposal();
  for (const user of [member, other])
    await expect(revise(action, 'Edited caption', null, user)).rejects.toThrow(
      'FORBIDDEN',
    );
});

it('rejects changed and revoked connections', async () => {
  const action = await proposal();
  await connection('67890');
  await expect(revise(action)).rejects.toThrow('CONNECTION_CHANGED');
  const revoked = await proposal();
  await db.query(
    "update integration_credentials set status='reconnect_required' where connection_id=$1",
    [revoked.connection_id],
  );
  await expect(revise(revoked)).rejects.toThrow('CONNECTION_CHANGED');
  const unverified = await proposal();
  await db.query(
    'update integration_credentials set verified_at=null where connection_id=$1',
    [unverified.connection_id],
  );
  await expect(revise(unverified)).rejects.toThrow('CONNECTION_CHANGED');
});

it.each(['sending', 'uncertain', 'confirmed'])(
  'never creates a new post after a %s publication attempt',
  async (status) => {
    const action = await proposal();
    await call('decide_action', [action.id, owner, 'accept']);
    const claim = await call('claim_action', [action.id, owner]);
    await call('begin_external_publish', [action.id, claim.token]);
    if (status !== 'sending')
      await call('record_external_publish', [
        action.id,
        claim.token,
        status,
        status === 'confirmed'
          ? {
              postId: '12345_67890',
              url: 'https://www.facebook.com/12345_67890',
            }
          : null,
      ]);
    await expect(revise(action)).rejects.toThrow('PUBLICATION_UNCERTAIN');
    expect(
      (
        await db.query(
          'select id from proposed_actions where replaces_action_id=$1',
          [action.id],
        )
      ).rows,
    ).toHaveLength(0);
  },
);

it('rejects link previews beside a photo and invalid captions or links', async () => {
  await expect(
    revise(await proposal({ image: true }), 'Caption', 'https://example.test'),
  ).rejects.toThrow('INVALID_INPUT');
  const action = await proposal();
  for (const message of ['', ' ', 'x'.repeat(5001)])
    await expect(revise(action, message)).rejects.toThrow('INVALID_INPUT');
  for (const link of [
    'http://example.test',
    'https://user:secret@example.test',
    'https://',
  ])
    await expect(revise(action, 'Caption', link)).rejects.toThrow(
      'INVALID_INPUT',
    );
});

it('keeps the RPC inaccessible to browser roles', async () => {
  const rows = (
    await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','public.revise_facebook_action(uuid,uuid,text,text)','execute') allowed",
    )
  ).rows;
  expect(rows[0].allowed).toBe(false);
});
