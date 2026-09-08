import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pg, readInfraConfig, repository } from './review-env.mjs';

// Real separately connected PostgreSQL transactions, including evidence of
// blocking from pg_stat_activity. No AI or HTTP is simulated by this test.
const config = readInfraConfig();
const clients = Array.from(
  { length: 3 },
  (_, n) =>
    new pg.Client({
      ...config.database,
      application_name: `onboarding-claim-proof-${n}`,
      statement_timeout: 10000,
    }),
);
const [a, b, observer] = clients;
const report = {
  startedAt: new Date().toISOString(),
  boundary:
    'Native PostgreSQL, independently connected transactions and database-observed blocking. Local synthetic owners only. Dispatch authorization is observed here; actual provider suppression is independently tested through HTTP.',
  checks: [],
};
const output =
  process.env.E2E_EVIDENCE_DIR || path.join(repository, 'evidence/round2');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture() {
  const user = randomUUID();
  await observer.query('insert into auth.users(id) values($1)', [user]);
  const workspace = (
    await observer.query(
      "select create_workspace('Synthetic onboarding claim proof',$1) id",
      [user],
    )
  ).rows[0].id;
  return { user, workspace };
}
async function accept(client, f, id, answer = 'Synthetic answer') {
  return (
    await client.query(
      "select accept_onboarding_request($1,$2,$3,$4,true,'Synthetic opening','unavailable') result",
      [f.workspace, f.user, id, answer],
    )
  ).rows[0].result;
}
async function finish(client, f, id, claim) {
  const now = new Date().toISOString();
  return client.query(
    'select finish_onboarding_request($1,$2,$3,$4,$5,$6,$7,false,$8)',
    [
      f.workspace,
      f.user,
      id,
      claim.token,
      JSON.stringify({
        display_name: 'Synthetic Claims',
        onboarding_status: 'review',
        updated_at: now,
      }),
      JSON.stringify({
        ...claim.session,
        messages: [
          ...claim.session.messages,
          {
            id: randomUUID(),
            role: 'assistant',
            content: `Reply to ${id}`,
            createdAt: now,
          },
        ],
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
async function stored(f) {
  return (
    await observer.query(
      `select
    (select count(*)::int from account_ai_requests where user_id=$1 and operation='onboarding') charges,
    (select count(*)::int from onboarding_requests where workspace_id=$2) requests,
    (select count(*)::int from audit_logs where workspace_id=$2 and event='onboarding.turn_saved') audits,
    (select messages from onboarding_sessions where workspace_id=$2) messages`,
      [f.user, f.workspace],
    )
  ).rows[0];
}
async function overlap(name, first, second, verify) {
  await a.query('begin');
  await b.query('begin');
  await a.query('set local role service_role');
  await b.query('set local role service_role');
  let pending;
  try {
    const firstResult = await first(a);
    let settled = false;
    pending = second(b).then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error: { code: error.code, message: error.message } };
      },
    );
    let blocking;
    const start = performance.now();
    while (performance.now() - start < 5000) {
      const state = (
        await observer.query(
          'select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',
          [b.processID],
        )
      ).rows[0];
      if (state?.blockers.includes(a.processID)) {
        blocking = state;
        break;
      }
      assert.equal(
        settled,
        false,
        'Contender finished before overlap was observed',
      );
      await pause(20);
    }
    assert.ok(
      blocking,
      'Expected independently connected transaction to wait on first transaction',
    );
    assert.notEqual(a.processID, b.processID);
    assert.equal(settled, false);
    await a.query('commit');
    const secondResult = await pending;
    await b.query(secondResult.error ? 'rollback' : 'commit');
    await verify(firstResult, secondResult);
    report.checks.push({
      name,
      passed: true,
      firstPid: a.processID,
      secondPid: b.processID,
      observedBlocking: blocking,
      overlapMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    await a.query('rollback');
    if (pending) await pending;
    await b.query('rollback');
    report.checks.push({ name, passed: false, error: error.message });
    throw error;
  }
}
try {
  await Promise.all(clients.map((client) => client.connect()));
  report.server = (
    await observer.query('select version() version')
  ).rows[0].version;
  const archived = await fixture();
  const secondOwner = randomUUID();
  await observer.query('insert into auth.users(id) values($1)', [secondOwner]);
  await observer.query(
    "insert into workspace_members(workspace_id,user_id,role) values($1,$2,'owner')",
    [archived.workspace, secondOwner],
  );
  const otherOwner = { workspace: archived.workspace, user: secondOwner };
  await overlap(
    'second-owner acceptance waits for archive and rejects its newly archived workspace',
    (client) =>
      client.query('select set_workspace_status($1,$2,$3)', [
        archived.workspace,
        archived.user,
        'archived',
      ]),
    (client) => accept(client, otherOwner, randomUUID()),
    async (_, second) => {
      assert.match(second.error?.message || '', /WORKSPACE_ARCHIVED/);
      const state = await stored(otherOwner);
      assert.equal(state.charges, 0);
      assert.equal(state.requests, 0);
      assert.equal(state.messages, null);
    },
  );
  const duplicate = await fixture(),
    same = randomUUID();
  let original;
  await overlap(
    'same ID and payload: one accepted charge, one dispatch authorization',
    (client) => accept(client, duplicate, same),
    (client) => accept(client, duplicate, same),
    async (first, second) => {
      assert.equal(first.dispatch, true);
      original = first;
      assert.deepEqual(second, {
        value: { dispatch: false, status: 'working' },
      });
      const state = await stored(duplicate);
      assert.equal(state.charges, 1);
      assert.equal(state.requests, 1);
      assert.equal(
        state.messages.filter((message) => message.id === same).length,
        1,
      );
    },
  );
  await finish(observer, duplicate, same, original);
  assert.deepEqual(await accept(observer, duplicate, same), {
    dispatch: false,
    status: 'completed',
  });
  assert.equal((await stored(duplicate)).audits, 1);

  const changed = await fixture(),
    changedId = randomUUID();
  await overlap(
    'same ID changed payload conflicts after the committed first acceptance',
    (client) => accept(client, changed, changedId),
    (client) => accept(client, changed, changedId, 'Changed answer'),
    async (_, second) => {
      assert.match(second.error?.message || '', /ONBOARDING_REQUEST_MISMATCH/);
      const state = await stored(changed);
      assert.equal(state.charges, 1);
      assert.equal(state.requests, 1);
      assert.deepEqual(
        state.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content),
        ['Synthetic answer'],
      );
    },
  );

  const queue = await fixture(),
    firstId = randomUUID(),
    secondId = randomUUID();
  let firstClaim;
  await overlap(
    'different overlapping answers both persist and only the first starts',
    (client) => accept(client, queue, firstId, 'First saved answer'),
    (client) => accept(client, queue, secondId, 'Second saved answer'),
    async (first, second) => {
      firstClaim = first;
      assert.equal(first.dispatch, true);
      assert.deepEqual(second, {
        value: { dispatch: false, status: 'queued' },
      });
      const state = await stored(queue);
      assert.equal(state.charges, 2);
      assert.equal(state.requests, 2);
      assert.deepEqual(
        state.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id),
        [firstId, secondId],
      );
    },
  );
  let secondClaim;
  await overlap(
    'queued promotion waits for atomic preceding completion and sees its reply',
    (client) => finish(client, queue, firstId, firstClaim),
    (client) => accept(client, queue, secondId, 'Second saved answer'),
    async (_, second) => {
      assert.equal(second.error, undefined);
      secondClaim = second.value;
      assert.equal(secondClaim.dispatch, true);
      assert.deepEqual(
        secondClaim.session.messages.map((message) => message.content),
        [
          'Synthetic opening',
          'First saved answer',
          `Reply to ${firstId}`,
          'Second saved answer',
        ],
      );
      assert.equal((await stored(queue)).charges, 2);
    },
  );
  await finish(observer, queue, secondId, secondClaim);
  const finalQueue = await stored(queue);
  assert.equal(finalQueue.audits, 2);
  assert.equal(finalQueue.charges, 2);
  assert.deepEqual(
    finalQueue.messages.map((message) => message.content),
    [
      'Synthetic opening',
      'First saved answer',
      `Reply to ${firstId}`,
      'Second saved answer',
      `Reply to ${secondId}`,
    ],
  );

  const expiry = await fixture(),
    expiredId = randomUUID(),
    laterId = randomUUID();
  const expiredClaim = await accept(observer, expiry, expiredId);
  await observer.query('select fail_onboarding_request($1,$2,$3,$4,true)', [
    expiry.workspace,
    expiry.user,
    expiredId,
    expiredClaim.token,
  ]);
  assert.deepEqual(await accept(observer, expiry, laterId, 'Later request'), {
    dispatch: false,
    status: 'queued',
  });
  await assert.rejects(
    finish(observer, expiry, expiredId, expiredClaim),
    /CONFLICT/,
  );
  await observer.query(
    "update onboarding_requests set lease_expires_at=clock_timestamp()-interval '1 second' where user_id=$1 and request_id=$2",
    [expiry.user, expiredId],
  );
  assert.equal(
    (await accept(observer, expiry, laterId, 'Later request')).dispatch,
    true,
  );
  assert.deepEqual(await accept(observer, expiry, expiredId), {
    dispatch: false,
    status: 'failed',
  });
  assert.equal((await stored(expiry)).charges, 2);
  report.checks.push({
    name: 'uncertain execution retains lease, expiry is terminal, stale token is fenced',
    passed: true,
    boundary:
      'Lease timestamp deliberately advanced in this synthetic fixture; no claim that real 150 seconds elapsed.',
  });
} catch (error) {
  report.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.end().catch(() => {})));
  report.finishedAt = new Date().toISOString();
  mkdirSync(output, { recursive: true });
  writeFileSync(
    path.join(output, 'native-onboarding-claims.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      checks: report.checks.map(({ name, passed }) => ({ name, passed })),
      error: report.error,
    }),
  );
}
