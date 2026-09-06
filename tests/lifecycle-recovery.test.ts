import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
async function conversation() {
  return (
    await db.query<{ id: string }>(
      'insert into conversations(workspace_id,created_by) values($1,$2) returning id',
      [workspace, owner],
    )
  ).rows[0].id;
}
async function generation(provider: string) {
  return call<number>('lock_integration_generation', [workspace, provider]);
}
async function calendarConnection() {
  const connection = id();
  await call('complete_calendar_connection', [
    workspace,
    owner,
    await generation('google_calendar'),
    connection,
    'encrypted',
    'Verified calendar',
    ['calendar.events'],
    {},
  ]);
  return connection;
}
async function calendarAction(
  connectionId: string,
  startsAt = Date.now() + 86400000,
) {
  const action = id();
  await db.query(
    "insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload,connection_id) values($1,$2,$3,'maintenance','calendar.create','Service booking',$4,$5)",
    [
      action,
      workspace,
      await conversation(),
      {
        summary: 'Service visit',
        start: new Date(startsAt).toISOString(),
        end: new Date(startsAt + 3600000).toISOString(),
        timeZone: 'Australia/Sydney',
        description: '',
      },
      connectionId,
    ],
  );
  return action;
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
  await db.query('insert into auth.users(id) values($1),($2),($3)', [
    owner,
    other,
    member,
  ]);
  workspace = await call<string>('create_workspace', [
    'Recovery fixtures',
    owner,
    'sandbox',
  ]);
  await db.query(
    "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'member')",
    [workspace, member],
  );
  await db.query('update workspaces set ai_consent_at=now() where id=$1', [
    workspace,
  ]);
});
afterAll(async () => {
  await db.close();
});

describe('durable Chat recovery', () => {
  it('expires the same request on replay without duplicating its saved message', async () => {
    const params = [
      workspace,
      await conversation(),
      owner,
      id(),
      'Draft a caption',
      [],
    ];
    const run = await call('begin_chat', params);
    await db.query(
      "update agent_runs set lease_expires_at=now()-interval '1 second' where id=$1",
      [run.id],
    );
    for (let replay = 0; replay < 2; replay++) {
      expect(await call('begin_chat', params)).toMatchObject({
        id: run.id,
        existing: true,
        status: 'failed',
        errorCode: 'INTERRUPTED',
        userMessageId: run.userMessageId,
      });
    }
    expect(
      (await db.query('select id from messages where run_id=$1', [run.id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from audit_logs where event='chat.interrupted' and entity_id=$1",
          [run.id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('expires stale work by polling, enforces membership and rejects late completion', async () => {
    const request = id();
    const run = await call('begin_chat', [
      workspace,
      await conversation(),
      owner,
      request,
      'Help with maintenance',
      [],
    ]);
    await expect(
      call('read_chat_receipt', [workspace, other, request]),
    ).rejects.toThrow('FORBIDDEN');
    await db.query(
      "update agent_runs set lease_expires_at=now()-interval '1 second' where id=$1",
      [run.id],
    );
    await expect(
      call('complete_chat', [run.id, 'Too late', [], [], 'test', []]),
    ).rejects.toThrow('CONFLICT');
    expect(
      await call('read_chat_receipt', [workspace, owner, request]),
    ).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
    expect(
      (
        await db.query(
          "select id from messages where run_id=$1 and role='assistant'",
          [run.id],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('keeps fresh work busy and returns the final reply and all eight attempts', async () => {
    const convo = await conversation(),
      request = id();
    const run = await call('begin_chat', [
      workspace,
      convo,
      owner,
      request,
      'Draft a response',
      [],
    ]);
    expect(
      Date.parse(run.leaseExpiresAt as string) - Date.now(),
    ).toBeGreaterThan(140_000);
    await expect(
      call('begin_chat', [workspace, convo, owner, id(), 'Another', []]),
    ).rejects.toThrow('BUSY');
    await expect(
      call('begin_chat', [
        workspace,
        convo,
        owner,
        request,
        'Changed text',
        [],
      ]),
    ).rejects.toThrow('CONFLICT');
    const trace = Array.from({ length: 8 }, (_, attempt) => ({
      provider: 'openai',
      status: 'completed',
      attempt,
    }));
    await call('complete_chat', [
      run.id,
      'Finished reply',
      [],
      [],
      'test',
      [],
      [],
      trace,
    ]);
    expect(
      await call('read_chat_receipt', [workspace, owner, request]),
    ).toMatchObject({
      status: 'completed',
      assistantMessage: {
        content: 'Finished reply',
        role: 'assistant',
        run_id: run.id,
      },
    });
    expect(
      (
        await db.query<{ provider_trace: unknown }>(
          'select provider_trace from agent_runs where id=$1',
          [run.id],
        )
      ).rows[0].provider_trace,
    ).toEqual(trace);
  });

  it('shares receipts with workspace members consistently with tenant message reads, without allowing them to replay another author’s request', async () => {
    const convo = await conversation(),
      request = id();
    const run = await call('begin_chat', [
      workspace,
      convo,
      owner,
      request,
      'Shared workspace note',
      [],
    ]);
    expect(
      await call('read_chat_receipt', [workspace, member, request]),
    ).toMatchObject({ id: run.id, status: 'working' });
    await expect(
      call('begin_chat', [
        workspace,
        convo,
        member,
        request,
        'Shared workspace note',
        [],
      ]),
    ).rejects.toThrow('CONFLICT');
  });
});

describe('OAuth disconnect fencing', () => {
  it('rejects an in-flight Calendar callback after disconnect, then accepts a new flow', async () => {
    const state = id();
    await db.query(
      'insert into oauth_states(state_hash,cookie_hash,workspace_id,user_id,verifier) values($1,$2,$3,$4,$5)',
      [state, 'cookie', workspace, owner, 'pkce'],
    );
    const consumed = await call('consume_oauth_state', [state, 'cookie']);
    await call('disconnect_integration', [
      workspace,
      'google_calendar',
      owner,
      null,
    ]);
    await expect(
      call('complete_calendar_connection', [
        workspace,
        owner,
        consumed.generation,
        id(),
        'encrypted',
        'Stale callback',
        [],
        {},
      ]),
    ).rejects.toThrow('CONNECTION_CHANGED');
    expect(
      (
        await db.query(
          "select * from integration_credentials where workspace_id=$1 and provider='google_calendar'",
          [workspace],
        )
      ).rows,
    ).toHaveLength(0);
    const next = await calendarConnection();
    expect(
      (
        await db.query<{ connection_id: string }>(
          "select connection_id from integration_credentials where workspace_id=$1 and provider='google_calendar'",
          [workspace],
        )
      ).rows[0].connection_id,
    ).toBe(next);
  });

  it('fences candidate insertion and resource selection, and rejects a stale disconnect', async () => {
    const oldGeneration = await generation('google_ads'),
      candidate = id();
    await db.query(
      "insert into integration_candidates(id,workspace_id,user_id,provider,ciphertext,generation) values($1,$2,$3,'google_ads','encrypted',$4)",
      [candidate, workspace, owner, oldGeneration],
    );
    await call('disconnect_integration', [
      workspace,
      'google_ads',
      owner,
      null,
    ]);
    await expect(
      db.query(
        "insert into integration_candidates(id,workspace_id,user_id,provider,ciphertext,generation) values($1,$2,$3,'google_ads','encrypted',$4)",
        [id(), workspace, owner, oldGeneration],
      ),
    ).rejects.toThrow('CONNECTION_CHANGED');
    await expect(
      call('complete_provider_connection', [
        candidate,
        owner,
        id(),
        'encrypted',
        '12345',
        'Old selection',
        [],
        {},
      ]),
    ).rejects.toThrow('FORBIDDEN');
    const current = await calendarConnection();
    await expect(
      call('disconnect_integration', [
        workspace,
        'google_calendar',
        owner,
        id(),
      ]),
    ).rejects.toThrow('CONNECTION_CHANGED');
    expect(
      (
        await db.query<{ connection_id: string }>(
          "select connection_id from integration_credentials where workspace_id=$1 and provider='google_calendar'",
          [workspace],
        )
      ).rows[0].connection_id,
    ).toBe(current);
  });

  it('keeps generation and recovery RPCs inaccessible to browser roles', async () => {
    const rows = (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('authenticated',oid,'EXECUTE') allowed from pg_proc where pronamespace='public'::regnamespace and proname in ('read_chat_receipt','disconnect_integration','complete_calendar_connection','replace_connection_action','cancel_action','lock_integration_generation','advance_integration_generation')",
      )
    ).rows;
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => !row.allowed)).toBe(true);
    await expect(
      call('disconnect_integration', [
        workspace,
        'google_calendar',
        other,
        null,
      ]),
    ).rejects.toThrow('FORBIDDEN');
  });
});

describe('immutable approval replacement', () => {
  async function facebookConnection(pageId: string) {
    const candidate = id(),
      connection = id();
    await db.query(
      "insert into integration_candidates(id,workspace_id,user_id,provider,ciphertext,generation) values($1,$2,$3,'facebook','encrypted',$4)",
      [candidate, workspace, owner, await generation('facebook')],
    );
    await call('complete_provider_connection', [
      candidate,
      owner,
      connection,
      'encrypted',
      pageId,
      'Selected Page ' + pageId,
      ['pages_manage_posts'],
      {},
    ]);
    return connection;
  }
  async function facebookAction(connection: string, pageId: string) {
    const action = id();
    await db.query(
      "insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload,connection_id) values($1,$2,$3,'social','facebook.publish','Approved caption',$4,$5)",
      [
        action,
        workspace,
        await conversation(),
        { pageId, message: 'Exact caption', imageFileId: null, link: null },
        connection,
      ],
    );
    return action;
  }

  it('binds a replacement post to the newly selected Page while preserving the original payload', async () => {
    const action = await facebookAction(
      await facebookConnection('12345'),
      '12345',
    );
    await call('decide_action', [action, owner, 'accept']);
    const nextConnection = await facebookConnection('67890');
    const replacement = await call('replace_connection_action', [
      action,
      owner,
      nextConnection,
    ]);
    expect(replacement).toMatchObject({
      status: 'waiting_approval',
      connection_id: nextConnection,
      payload: { pageId: '67890', message: 'Exact caption' },
      approved_by: null,
    });
    expect(
      (
        await db.query<{ payload: unknown }>(
          'select payload from proposed_actions where id=$1',
          [action],
        )
      ).rows[0].payload,
    ).toMatchObject({ pageId: '12345' });
  });

  it('never proposes a replacement for an unresolved Facebook send', async () => {
    const action = await facebookAction(
      await facebookConnection('12345'),
      '12345',
    );
    await call('decide_action', [action, owner, 'accept']);
    const claim = await call('claim_action', [action, owner]);
    await call('begin_external_publish', [action, claim.token]);
    await call('finish_action', [
      action,
      claim.token,
      null,
      'PUBLICATION_UNCERTAIN',
    ]);
    await expect(
      call('replace_connection_action', [
        action,
        owner,
        await facebookConnection('67890'),
      ]),
    ).rejects.toThrow('PUBLICATION_UNCERTAIN');
    expect(
      (
        await db.query(
          'select id from proposed_actions where replaces_action_id=$1',
          [action],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('supersedes a failed approved action with a new proposal requiring fresh approval', async () => {
    const oldConnection = await calendarConnection(),
      action = await calendarAction(oldConnection);
    await call('decide_action', [action, owner, 'accept']);
    const claim = await call('claim_action', [action, owner]);
    await call('finish_action', [
      action,
      claim.token,
      null,
      'RECONNECT_REQUIRED',
    ]);
    const newConnection = await calendarConnection();
    await expect(call('claim_action', [action, owner])).rejects.toThrow(
      'CONNECTION_CHANGED',
    );
    const replacement = await call('replace_connection_action', [
      action,
      owner,
      newConnection,
    ]);
    expect(replacement).toMatchObject({
      status: 'waiting_approval',
      connection_id: newConnection,
      replaces_action_id: action,
      approved_by: null,
      approved_at: null,
      attempts: 0,
    });
    const original = (
      await db.query<{ payload: unknown }>(
        'select * from proposed_actions where id=$1',
        [action],
      )
    ).rows[0];
    expect(original).toMatchObject({
      status: 'superseded',
      connection_id: oldConnection,
      superseded_by: replacement.id,
      approved_by: owner,
    });
    expect(original.payload).toEqual(replacement.payload);
    await expect(call('claim_action', [replacement.id, owner])).rejects.toThrow(
      'CONFLICT',
    );
    expect(
      (await call('replace_connection_action', [action, owner, newConnection]))
        .id,
    ).toBe(replacement.id);
    expect(
      (
        await db.query('select * from action_approvals where action_id=$1', [
          replacement.id,
        ])
      ).rows,
    ).toHaveLength(0);
    await call('decide_action', [replacement.id, owner, 'accept']);
    expect((await call('claim_action', [replacement.id, owner])).claimed).toBe(
      true,
    );
  });

  it('lets an owner cancel an approved failure while preserving its approval', async () => {
    const action = await calendarAction(await calendarConnection());
    await call('decide_action', [action, owner, 'accept']);
    const claim = await call('claim_action', [action, owner]);
    await call('finish_action', [
      action,
      claim.token,
      null,
      'RECONNECT_REQUIRED',
    ]);
    await expect(call('cancel_action', [action, other])).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(await call('cancel_action', [action, owner])).toMatchObject({
      status: 'cancelled',
      approved_by: owner,
    });
    expect(
      (
        await db.query(
          "select * from action_approvals where action_id=$1 and decision='accept'",
          [action],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(call('claim_action', [action, owner])).rejects.toThrow(
      'CONFLICT',
    );
  });

  it('blocks replacement when an earlier Calendar write has an unknown outcome', async () => {
    const action = await calendarAction(await calendarConnection());
    await call('decide_action', [action, owner, 'accept']);
    const claim = await call('claim_action', [action, owner]);
    await call('finish_action', [
      action,
      claim.token,
      null,
      'UPSTREAM_UNAVAILABLE',
    ]);
    await expect(
      call('replace_connection_action', [
        action,
        owner,
        await calendarConnection(),
      ]),
    ).rejects.toThrow('OUTCOME_REVIEW_REQUIRED');
    expect(
      (
        await db.query<{ status: string }>(
          'select status from proposed_actions where id=$1',
          [action],
        )
      ).rows[0].status,
    ).toBe('failed');
  });

  it('does not let a later reconnect failure hide an earlier uncertain Calendar write', async () => {
    const action = await calendarAction(await calendarConnection());
    await call('decide_action', [action, owner, 'accept']);
    const first = await call('claim_action', [action, owner]);
    await call('finish_action', [
      action,
      first.token,
      null,
      'UPSTREAM_UNAVAILABLE',
    ]);
    const retry = await call('claim_action', [action, owner]);
    await call('finish_action', [
      action,
      retry.token,
      null,
      'RECONNECT_REQUIRED',
    ]);
    await expect(
      call('replace_connection_action', [
        action,
        owner,
        await calendarConnection(),
      ]),
    ).rejects.toThrow('OUTCOME_REVIEW_REQUIRED');
    expect(
      (
        await db.query(
          'select id from proposed_actions where replaces_action_id=$1',
          [action],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('requires a new booking date when the original Calendar time has passed', async () => {
    const action = await calendarAction(
      await calendarConnection(),
      Date.now() - 3600000,
    );
    const nextConnection = await calendarConnection();
    await expect(
      call('replace_connection_action', [action, owner, nextConnection]),
    ).rejects.toThrow('CALENDAR_DATE_PASSED');
    expect(
      (
        await db.query(
          'select id from proposed_actions where replaces_action_id=$1',
          [action],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ status: string }>(
          'select status from proposed_actions where id=$1',
          [action],
        )
      ).rows[0].status,
    ).toBe('waiting_approval');
  });
});
