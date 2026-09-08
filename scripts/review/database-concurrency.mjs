import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  evidenceRoot,
  pg,
  readInfraConfig,
  repository,
} from './review-env.mjs';

// Run: node scripts/review/database-concurrency.mjs
// Requires the explicitly provisioned disposable local infrastructure. Refuses
// arbitrary hosts or a configuration without its synthetic designation.
const config = readInfraConfig();
const { Client } = pg;
mkdirSync(evidenceRoot, { recursive: true });
const clients = Array.from(
  { length: 3 },
  (_, index) =>
    new Client({
      ...config.database,
      application_name: `independent-db-review-${index}`,
      statement_timeout: 10000,
    }),
);
const [a, b, observer] = clients;
const report = {
  startedAt: new Date().toISOString(),
  scope:
    'Real PostgreSQL server; independently connected transactions; synthetic Auth and Storage metadata fixtures; no external provider',
  checks: [],
};
const id = () => randomUUID();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(client, name, values) {
  // node-postgres encodes JavaScript arrays as PostgreSQL arrays. JSONB RPC
  // inputs require explicit JSON; begin_chat's sixth argument is really uuid[].
  const encoded = values.map((value, index) =>
    Array.isArray(value) && !(name === 'begin_chat' && index === 5)
      ? JSON.stringify(value)
      : value,
  );
  return (
    await client.query(
      `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) value`,
      encoded,
    )
  ).rows[0].value;
}
async function owner() {
  const user = id();
  await observer.query('insert into auth.users(id) values($1)', [user]);
  return user;
}
async function workspace(user) {
  const workspaceId = await call(observer, 'create_workspace', [
    'Independent connection fixture',
    user,
  ]);
  await observer.query(
    'update workspaces set ai_consent_at=now() where id=$1',
    [workspaceId],
  );
  return {
    user,
    workspace: workspaceId,
    conversation: (
      await observer.query(
        'select id from conversations where workspace_id=$1',
        [workspaceId],
      )
    ).rows[0].id,
  };
}

async function browserQuery(user, sql, params = []) {
  await observer.query('begin');
  try {
    await observer.query('set local role authenticated');
    await observer.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const result = await observer.query(sql, params);
    await observer.query('commit');
    return result.rows;
  } catch (error) {
    await observer.query('rollback');
    throw error;
  }
}

async function overlap(name, first, second, verify) {
  const started = performance.now();
  await a.query('begin');
  await b.query('begin');
  await a.query('set local role service_role');
  await b.query('set local role service_role');
  try {
    const firstResult = await first(a);
    let secondFinished = false;
    const pending = second(b).then(
      (value) => {
        secondFinished = true;
        return { value };
      },
      (error) => {
        secondFinished = true;
        return { error: { code: error.code, message: error.message } };
      },
    );
    let blocked;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const status = (
        await observer.query(
          'select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',
          [b.processID],
        )
      ).rows[0];
      if (status?.blockers.includes(a.processID)) {
        blocked = status;
        break;
      }
      assert.equal(
        secondFinished,
        false,
        `${name}: contender finished before an overlap was proved`,
      );
      await pause(20);
    }
    assert.ok(blocked, `${name}: no database-observed transaction overlap`);
    assert.equal(secondFinished, false);
    assert.notEqual(a.processID, b.processID);
    await a.query('commit');
    const secondResult = await pending;
    await b.query(secondResult.error ? 'rollback' : 'commit');
    await verify(firstResult, secondResult);
    report.checks.push({
      name,
      passed: true,
      firstPid: a.processID,
      secondPid: b.processID,
      observedBlocking: blocked,
      durationMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    await a.query('rollback');
    await b.query('rollback');
    throw error;
  }
}

try {
  await Promise.all(clients.map((client) => client.connect()));
  report.server = (
    await observer.query('select version() version')
  ).rows[0].version;
  const dir = path.join(repository, 'supabase/migrations');
  report.migrations = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sha256: createHash('sha256')
        .update(readFileSync(path.join(dir, name)))
        .digest('hex'),
    }));

  const user = await owner();
  const archived = await workspace(user);
  await call(observer, 'set_workspace_status', [
    archived.workspace,
    user,
    'archived',
  ]);
  for (let i = 0; i < 19; i++) await workspace(user);
  await overlap(
    'create versus restore serializes the final active workspace slot',
    (client) =>
      call(client, 'create_workspace', ['Final available slot', user]),
    (client) =>
      call(client, 'set_workspace_status', [
        archived.workspace,
        user,
        'active',
      ]),
    async (_, result) => {
      assert.equal(result.error?.message, 'TAI:WORKSPACE_ACTIVE_LIMIT');
      assert.equal(
        (
          await observer.query(
            "select count(*)::integer count from workspaces where personal_owner=$1 and status='active'",
            [user],
          )
        ).rows[0].count,
        20,
      );
      assert.equal(
        (
          await observer.query('select status from workspaces where id=$1', [
            archived.workspace,
          ])
        ).rows[0].status,
        'archived',
      );
      assert.equal(
        (
          await observer.query(
            "select count(*)::integer count from audit_logs where entity_id=$1 and event='workspace.active'",
            [archived.workspace],
          )
        ).rows[0].count,
        0,
      );
    },
  );

  const chat = await workspace(await owner());
  const requestId = id();
  const args = [
    chat.workspace,
    chat.conversation,
    chat.user,
    requestId,
    'Independent overlapping duplicate',
    [],
  ];
  await overlap(
    'same chat request on independent connections creates one run and one quota charge',
    (client) => call(client, 'begin_chat', args),
    (client) => call(client, 'begin_chat', args),
    async (first, second) => {
      assert.equal(second.error, undefined);
      assert.equal(second.value.id, first.id);
      assert.equal(second.value.existing, true);
      assert.equal(
        (
          await observer.query(
            'select count(*)::integer count from agent_runs where workspace_id=$1 and request_id=$2',
            [chat.workspace, requestId],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await observer.query(
            'select count(*)::integer count from messages where run_id=$1',
            [first.id],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await observer.query(
            "select count(*)::integer requests from account_ai_requests where user_id=$1 and operation='chat' and request_id=$2",
            [chat.user, requestId],
          )
        ).rows[0].requests,
        1,
      );
    },
  );

  const counter = await workspace(await owner());
  // A limit of one is a test-only RPC argument to expose the final-slot race.
  // This legacy counter remains used by non-AI operations. Account AI quota
  // races are additionally covered by native-account-quotas.mjs.
  await overlap(
    'counter contention admits one request and rolls back the rejected increment',
    (client) =>
      call(client, 'consume_rate', [
        counter.workspace,
        counter.user,
        'independent-review',
        1,
      ]),
    (client) =>
      call(client, 'consume_rate', [
        counter.workspace,
        counter.user,
        'independent-review',
        1,
      ]),
    async (_, second) => {
      assert.equal(second.error?.message, 'TAI:RATE_LIMITED');
      assert.equal(
        (
          await observer.query(
            "select requests from rate_limits where workspace_id=$1 and user_id=$2 and operation='independent-review'",
            [counter.workspace, counter.user],
          )
        ).rows[0].requests,
        1,
      );
    },
  );

  const forbiddenTables = (
    await observer.query(
      "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and (not relrowsecurity or has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('anon',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))",
    )
  ).rows;
  assert.deepEqual(forbiddenTables, []);
  const wrongFunctions = (
    await observer.query(
      "select proname from pg_proc where pronamespace='public'::regnamespace and prorettype<>'trigger'::regtype and (has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('authenticated',oid,'EXECUTE')<>(proname in ('is_member','is_support_operator','bootstrap_workspace')))",
    )
  ).rows;
  assert.deepEqual(wrongFunctions, []);
  report.checks.push({
    name: 'native PostgreSQL catalogs confirm all table RLS/write grants and non-trigger RPC grants',
    passed: true,
  });

  const bilateral = [
    await workspace(await owner()),
    await workspace(await owner()),
  ];
  for (const [index, tenant] of bilateral.entries()) {
    const run = await call(observer, 'begin_chat', [
      tenant.workspace,
      tenant.conversation,
      tenant.user,
      id(),
      `Synthetic native private input ${index}`,
      [],
    ]);
    await call(observer, 'complete_chat', [
      run.id,
      `Synthetic native private reply ${index}`,
      [],
      [],
      'synthetic',
      [],
    ]);
    const action = id();
    await observer.query(
      "insert into proposed_actions(id,workspace_id,conversation_id,agent,action_type,summary,payload) values($1,$2,$3,'maintenance','record.create','Synthetic native action',$4)",
      [
        action,
        tenant.workspace,
        tenant.conversation,
        {
          kind: 'note',
          title: `Private native record ${index}`,
          body: 'Synthetic private body',
        },
      ],
    );
    await call(observer, 'decide_action', [action, tenant.user, 'accept']);
    const claim = await call(observer, 'claim_action', [action, tenant.user]);
    await call(observer, 'finish_action', [
      action,
      claim.token,
      { saved: true },
      null,
    ]);
    const file = id();
    tenant.path = `${tenant.workspace}/${file}/native-private.pdf`;
    await observer.query(
      "insert into uploaded_files(id,workspace_id,conversation_id,uploaded_by,filename,object_path,mime_type,size_bytes,sha256,status) values($1,$2,$3,$4,'native-private.pdf',$5,'application/pdf',10,$6,'ready')",
      [
        file,
        tenant.workspace,
        tenant.conversation,
        tenant.user,
        tenant.path,
        'a'.repeat(64),
      ],
    );
    await observer.query(
      "insert into storage.objects(bucket_id,name) values('workspace-files',$1)",
      [tenant.path],
    );
    await observer.query(
      'insert into business_profiles(workspace_id,display_name) values($1,$2)',
      [tenant.workspace, `Private native profile ${index}`],
    );
    await observer.query(
      "insert into business_profile_facts(workspace_id,field_path,value,source_type,source_label,confidence,fact_state) values($1,'display_name',$2,'owner_message','Synthetic fixture','high','owner_supplied')",
      [tenant.workspace, JSON.stringify(`Private native fact ${index}`)],
    );
    await observer.query(
      'insert into onboarding_sessions(workspace_id,user_id,messages) values($1,$2,$3)',
      [
        tenant.workspace,
        tenant.user,
        JSON.stringify([
          {
            id: id(),
            role: 'user',
            content: `Private native onboarding ${index}`,
          },
        ]),
      ],
    );
    await call(observer, 'create_case', [
      tenant.workspace,
      tenant.conversation,
      tenant.user,
      'maintenance',
      'missing_information',
      `Private native case ${index}`,
      true,
    ]);
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
  for (const [actor, target] of [
    [bilateral[0], bilateral[1]],
    [bilateral[1], bilateral[0]],
  ]) {
    for (const table of ['workspaces', ...tenantTables]) {
      const key = table === 'workspaces' ? 'id' : 'workspace_id';
      const sql = `select * from ${table} where ${key}=$1`;
      assert.ok(
        (await browserQuery(target.user, sql, [target.workspace])).length > 0,
        `${table}: missing positive control`,
      );
      assert.deepEqual(
        await browserQuery(actor.user, sql, [target.workspace]),
        [],
        `${table}: foreign rows disclosed`,
      );
    }
    assert.equal(
      (
        await browserQuery(
          target.user,
          'select * from storage.objects where name=$1',
          [target.path],
        )
      ).length,
      1,
    );
    assert.deepEqual(
      await browserQuery(
        actor.user,
        'select * from storage.objects where name=$1',
        [target.path],
      ),
      [],
    );
    await assert.rejects(
      browserQuery(actor.user, 'select * from integration_credentials'),
      /permission denied/,
    );
    await assert.rejects(
      browserQuery(actor.user, 'update rate_limits set requests=0'),
      /permission denied/,
    );
  }
  report.checks.push({
    name: 'native PostgreSQL RLS hides 16 populated tenant tables and storage metadata in BOTH directions with owner positive controls',
    passed: true,
    tenantTables: ['workspaces', ...tenantTables],
    directions: 2,
  });

  report.finishedAt = new Date().toISOString();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  writeFileSync(
    path.join(evidenceRoot, 'database-concurrency.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { passed: report.passed, checks: report.checks, failure: report.failure },
      null,
      2,
    ),
  );
}
