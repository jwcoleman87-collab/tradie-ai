import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pg, readInfraConfig, repository } from './review-env.mjs';

// The account policy is database-wide. Use a fresh database so changing fixture
// limits cannot affect parallel HTTP/browser tests or their synthetic policy.
const config = readInfraConfig();
const database = `e2e_synthetic_quota_${randomUUID().replaceAll('-', '')}`;
assert.match(database, /^e2e_synthetic_quota_[a-f0-9]{32}$/);
const admin = new pg.Client(config.database);
const clients = Array.from(
  { length: 3 },
  (_, n) =>
    new pg.Client({
      ...config.database,
      database,
      application_name: `account-quota-proof-${n}`,
      statement_timeout: 10000,
    }),
);
const [a, b, observer] = clients;
const output =
  process.env.E2E_EVIDENCE_DIR || path.join(repository, 'evidence/round2');
const policy = {
  chat_burst: 12,
  chat_daily: 10000,
  chat_concurrency: 1000,
  onboarding_burst: 10,
  onboarding_daily: 10000,
  workspace_active: 20,
  workspace_total: 10000,
  workspace_daily: 10000,
};
const disabled = Object.fromEntries(Object.keys(policy).map((key) => [key, 0]));
const report = {
  startedAt: new Date().toISOString(),
  boundary:
    'Native PostgreSQL independent transactions with pg_blocking_pids evidence. Fresh database, actual migrations and admission RPCs; no provider calls. Explicit synthetic limits only.',
  checks: [],
};
const id = () => randomUUID();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let created = false;
let connected = false;
async function call(client, name, values = []) {
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
async function configure(changes = {}) {
  await call(observer, 'configure_account_quotas', [{ ...policy, ...changes }]);
}
async function owner() {
  const user = id();
  await observer.query('insert into auth.users(id) values($1)', [user]);
  return user;
}
async function workspace(user) {
  const workspace = await call(observer, 'create_workspace', [
    'Synthetic quota race',
    user,
  ]);
  await observer.query(
    'update workspaces set ai_consent_at=clock_timestamp() where id=$1',
    [workspace],
  );
  const conversation = (
    await observer.query('select id from conversations where workspace_id=$1', [
      workspace,
    ])
  ).rows[0].id;
  return { user, workspace, conversation };
}
function chat(client, f, request = id()) {
  return call(client, 'begin_chat', [
    f.workspace,
    f.conversation,
    f.user,
    request,
    'Synthetic quota input',
    [],
  ]);
}
function onboarding(client, f, request = id()) {
  return call(client, 'accept_onboarding_request', [
    f.workspace,
    f.user,
    request,
    'Synthetic setup answer',
    true,
    'Synthetic opening',
    'unavailable',
  ]);
}
async function finish(run) {
  await call(observer, 'complete_chat', [
    run.id,
    'Synthetic reply',
    [],
    [],
    'synthetic',
    [],
  ]);
}
async function receiptCount(user, operation) {
  return (
    await observer.query(
      'select count(*)::integer n from account_ai_requests where user_id=$1 and operation=$2',
      [user, operation],
    )
  ).rows[0].n;
}
async function check(name, action) {
  await action();
  report.checks.push({ name, passed: true });
}
async function overlap(name, first, second, verify) {
  // Keep fixed-minute boundary transitions outside a final-slot race. The
  // daily reset cases below alter only synthetic timestamps, never DB clocks.
  const remaining = 60000 - (Date.now() % 60000);
  if (remaining < 2000) await pause(remaining + 10);
  await a.query('begin');
  await b.query('begin');
  await a.query('set local role service_role');
  await b.query('set local role service_role');
  try {
    const firstResult = await first(a);
    let settled = false;
    const pending = second(b).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error: { message: error.message, detail: error.detail } };
      },
    );
    let blocked;
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const state = (
        await observer.query(
          'select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',
          [b.processID],
        )
      ).rows[0];
      if (state?.blockers.includes(a.processID)) {
        blocked = state;
        break;
      }
      assert.equal(
        settled,
        false,
        `${name}: no independently observed overlap`,
      );
      await pause(10);
    }
    assert.ok(
      blocked,
      `${name}: contender must block on first independent connection`,
    );
    assert.notEqual(a.processID, b.processID);
    await a.query('commit');
    const result = await pending;
    await b.query(result.error ? 'rollback' : 'commit');
    await verify(firstResult, result);
    report.checks.push({
      name,
      passed: true,
      firstPid: a.processID,
      secondPid: b.processID,
      observedBlocking: blocked,
    });
  } catch (error) {
    await a.query('rollback');
    await b.query('rollback');
    throw error;
  }
}

try {
  await admin.connect();
  report.originalPolicy = (
    await admin.query('select * from public.account_quota_policy')
  ).rows[0];
  await admin.query(`create database "${database}"`);
  created = true;
  await Promise.all(clients.map((client) => client.connect()));
  connected = true;
  report.server = (
    await observer.query('select version() version')
  ).rows[0].version;
  const scaffold = readFileSync(
    path.join(repository, 'scripts/review/fixture.sql'),
    'utf8',
  );
  // Roles already belong to the explicitly provisioned synthetic cluster.
  await observer.query(scaffold.slice(scaffold.indexOf('create schema auth;')));
  const migrationDir = path.join(repository, 'supabase/migrations');
  report.migrations = [];
  for (const name of readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(path.join(migrationDir, name), 'utf8');
    await observer.query(sql);
    report.migrations.push({
      name,
      sha256: createHash('sha256').update(sql).digest('hex'),
    });
  }
  await check(
    'fresh migration fails closed; explicit setup is required even for default bootstrap',
    async () => {
      const user = await owner();
      await assert.rejects(
        call(observer, 'create_workspace', ['Unconfigured', user]),
        /TAI:QUOTA_CONFIG_INVALID/,
      );
      await observer.query(
        "select set_config('request.jwt.claim.sub',$1,false)",
        [user],
      );
      await assert.rejects(
        call(observer, 'bootstrap_workspace'),
        /TAI:QUOTA_CONFIG_INVALID/,
      );
      assert.equal(
        (await observer.query('select count(*)::integer n from workspaces'))
          .rows[0].n,
        0,
      );
      assert.equal(
        (
          await observer.query(
            'select count(*)::integer n from account_ai_requests',
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await configure();

  for (const [field, error] of [
    ['chat_burst', 'CHAT_BURST_LIMIT'],
    ['chat_daily', 'CHAT_DAILY_LIMIT'],
    ['chat_concurrency', 'CHAT_CONCURRENCY_LIMIT'],
  ]) {
    await configure(disabled);
    const user = await owner(),
      left = await workspace(user),
      right = await workspace(user);
    await configure({ ...disabled, [field]: 1 });
    await overlap(
      `${field}: two workspaces contend for one account slot`,
      (client) => chat(client, left),
      (client) => chat(client, right),
      async (first, result) => {
        assert.equal(result.error?.message, `TAI:${error}`);
        assert.equal(await receiptCount(user, 'chat'), 1);
        assert.equal(
          (
            await observer.query(
              'select count(*)::integer n from agent_runs where user_id=$1',
              [user],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await observer.query(
              'select count(*)::integer n from messages where workspace_id=$1',
              [right.workspace],
            )
          ).rows[0].n,
          0,
        );
        if (field !== 'chat_concurrency')
          assert.ok(JSON.parse(result.error.detail).retryAfterSeconds >= 1);
        await finish(first);
      },
    );
    const independent = await workspace(await owner());
    await chat(observer, independent);
  }
  for (const [field, error] of [
    ['onboarding_burst', 'ONBOARDING_BURST_LIMIT'],
    ['onboarding_daily', 'ONBOARDING_DAILY_LIMIT'],
  ]) {
    await configure(disabled);
    const user = await owner(),
      left = await workspace(user),
      right = await workspace(user);
    await configure({ ...disabled, [field]: 1 });
    await overlap(
      `${field}: acceptance and quota commit together across workspaces`,
      (client) => onboarding(client, left),
      (client) => onboarding(client, right),
      async (first, result) => {
        assert.equal(first.dispatch, true);
        assert.equal(result.error?.message, `TAI:${error}`);
        assert.equal(await receiptCount(user, 'onboarding'), 1);
        assert.equal(
          (
            await observer.query(
              'select count(*)::integer n from onboarding_requests where user_id=$1',
              [user],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await observer.query(
              'select count(*)::integer n from onboarding_sessions where workspace_id=$1',
              [right.workspace],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    assert.equal(
      (await onboarding(observer, await workspace(await owner()))).dispatch,
      true,
    );
  }

  for (const operation of ['chat', 'onboarding']) {
    await configure();
    const f = await workspace(await owner()),
      request = id();
    const begin = operation === 'chat' ? chat : onboarding;
    await overlap(
      `${operation}: overlapping same-ID replay charges and dispatches once`,
      (client) => begin(client, f, request),
      (client) => begin(client, f, request),
      async (first, second) => {
        assert.equal(second.error, undefined);
        assert.equal(await receiptCount(f.user, operation), 1);
        if (operation === 'chat') {
          assert.equal(second.value.id, first.id);
          assert.equal(second.value.existing, true);
        } else {
          assert.equal(first.dispatch, true);
          assert.equal(second.value.dispatch, false);
        }
      },
    );
  }

  for (const [field, error] of [
    ['workspace_active', 'WORKSPACE_ACTIVE_LIMIT'],
    ['workspace_total', 'WORKSPACE_TOTAL_LIMIT'],
    ['workspace_daily', 'WORKSPACE_DAILY_LIMIT'],
  ]) {
    await configure({ ...disabled, [field]: 1 });
    const user = await owner();
    await overlap(
      `${field}: optional create RPC cannot overshoot final capacity`,
      async (client) => {
        const w = await call(client, 'create_workspace', [
          'First synthetic creation',
          user,
        ]);
        if (field !== 'workspace_active')
          await call(client, 'set_workspace_status', [w, user, 'archived']);
        return w;
      },
      (client) =>
        call(client, 'create_workspace', ['Rejected synthetic creation', user]),
      async (_, result) => {
        assert.equal(result.error?.message, `TAI:${error}`);
        assert.equal(
          (
            await observer.query(
              'select count(*)::integer n from workspaces where personal_owner=$1',
              [user],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await observer.query(
              "select count(*)::integer n from audit_logs where actor_id=$1 and event='workspace.created'",
              [user],
            )
          ).rows[0].n,
          1,
        );
      },
    );
  }
  await configure(disabled);
  const restoreUser = await owner(),
    archived = await workspace(restoreUser);
  await call(observer, 'set_workspace_status', [
    archived.workspace,
    restoreUser,
    'archived',
  ]);
  await configure({ ...disabled, workspace_active: 1 });
  await overlap(
    'create versus restore shares the same account capacity lock',
    (client) =>
      call(client, 'create_workspace', ['Final active slot', restoreUser]),
    (client) =>
      call(client, 'set_workspace_status', [
        archived.workspace,
        restoreUser,
        'active',
      ]),
    async (_, result) => {
      assert.equal(result.error?.message, 'TAI:WORKSPACE_ACTIVE_LIMIT');
      assert.equal(
        (
          await observer.query('select status from workspaces where id=$1', [
            archived.workspace,
          ])
        ).rows[0].status,
        'archived',
      );
    },
  );

  await check(
    'daily resets use UTC acceptance windows; terminal and expired Chat work releases concurrency',
    async () => {
      await configure(disabled);
      const user = await owner(),
        left = await workspace(user),
        right = await workspace(user);
      await configure({ ...disabled, chat_daily: 1, chat_concurrency: 1 });
      const first = await chat(observer, left);
      await finish(first);
      await assert.rejects(chat(observer, right), /CHAT_DAILY_LIMIT/);
      await observer.query(
        "update account_ai_requests set accepted_at=(date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')-interval '1 second' where user_id=$1",
        [user],
      );
      const second = await chat(observer, right);
      await configure({ ...disabled, chat_concurrency: 1 });
      await assert.rejects(chat(observer, left), /CHAT_CONCURRENCY_LIMIT/);
      await observer.query(
        "update agent_runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [second.id],
      );
      await chat(observer, left);
      assert.equal(await receiptCount(user, 'chat'), 3);
    },
  );
  await check(
    'pending onboarding prevents archive; expired uncertain work permits it',
    async () => {
      await configure();
      const f = await workspace(await owner()),
        request = id();
      const claim = await onboarding(observer, f, request);
      await assert.rejects(
        call(observer, 'set_workspace_status', [
          f.workspace,
          f.user,
          'archived',
        ]),
        /ACTIVE_WORK_REMAINS/,
      );
      await call(observer, 'fail_onboarding_request', [
        f.workspace,
        f.user,
        request,
        claim.token,
        true,
      ]);
      await assert.rejects(
        call(observer, 'set_workspace_status', [
          f.workspace,
          f.user,
          'archived',
        ]),
        /ACTIVE_WORK_REMAINS/,
      );
      await observer.query(
        "update onboarding_requests set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=$1",
        [f.user],
      );
      await call(observer, 'set_workspace_status', [
        f.workspace,
        f.user,
        'archived',
      ]);
    },
  );
  await check(
    'explicit zero disables all ceilings, including the previous active workspace cap',
    async () => {
      await configure(disabled);
      const user = await owner();
      for (let n = 0; n < 21; n++) {
        const f = await workspace(user);
        await chat(observer, f);
        await onboarding(observer, f);
      }
      assert.equal(await receiptCount(user, 'chat'), 21);
      assert.equal(await receiptCount(user, 'onboarding'), 21);
    },
  );
  await check(
    'malformed policy updates fail atomically and browser roles cannot configure quotas',
    async () => {
      await configure();
      const before = (
        await observer.query('select * from account_quota_policy')
      ).rows;
      await assert.rejects(
        call(observer, 'configure_account_quotas', [
          { ...policy, chat_daily: -1 },
        ]),
        /QUOTA_CONFIG_INVALID/,
      );
      assert.deepEqual(
        (await observer.query('select * from account_quota_policy')).rows,
        before,
      );
      for (const role of ['authenticated', 'anon']) {
        await observer.query('begin');
        await observer.query(`set local role ${role}`);
        await assert.rejects(
          call(observer, 'configure_account_quotas', [disabled]),
          /permission denied/,
        );
        await observer.query('rollback');
      }
    },
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  if (connected) {
    // Explicitly restore the fixture policy even in the disposable database.
    try {
      await configure();
      report.fixturePolicyRestored = true;
    } catch (error) {
      report.fixturePolicyRestored = false;
      report.cleanupFailure = error.message;
      report.passed = false;
      process.exitCode = 1;
    }
  }
  await Promise.allSettled(clients.map((client) => client.end()));
  if (created) {
    try {
      assert.match(database, /^e2e_synthetic_quota_[a-f0-9]{32}$/);
      await admin.query(`drop database "${database}"`);
      report.disposableDatabaseRemoved = true;
      assert.deepEqual(
        (await admin.query('select * from public.account_quota_policy'))
          .rows[0],
        report.originalPolicy,
      );
      report.mainSyntheticPolicyUnchanged = true;
    } catch (error) {
      report.cleanupFailure = error.message;
      report.passed = false;
      process.exitCode = 1;
    }
  }
  await admin.end();
  report.finishedAt = new Date().toISOString();
  mkdirSync(output, { recursive: true });
  writeFileSync(
    path.join(output, 'native-account-quotas.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}
