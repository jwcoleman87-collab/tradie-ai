import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const phase =
  process.argv.find((arg) => arg.startsWith('--phase='))?.slice(8) ||
  'baseline';
if (!['baseline', 'final'].includes(phase))
  throw Error('Unsupported review phase');
const app = 'http://127.0.0.1:3108';
const gateway = 'http://127.0.0.1:55441';
const tooling = path.resolve('../e2e-tooling-20260908');
const config = JSON.parse(
  readFileSync(path.join(tooling, 'infra-config.json'), 'utf8'),
);
if (!['localhost', '127.0.0.1', '::1'].includes(config.database.host))
  throw Error('This review requires the isolated loopback database');
const { default: pg } = await import(
  pathToFileURL(path.join(tooling, 'node_modules/pg/lib/index.js'))
);
const pool = new pg.Pool(config.database);
const evidence = {
  phase,
  app,
  startedAt: new Date().toISOString(),
  boundaries:
    'Built production HTTP application and native PostgreSQL/PostgREST. Synthetic authentication, storage and AI gateway. No live external services. Fault triggers are scoped to newly-created synthetic workspace IDs. Concurrent HTTP requests are not claimed as independent-transaction SQL race tests.',
  checks: [],
};
async function api(token, endpoint, data) {
  const response = await fetch(`${app}/api/${endpoint}`, {
    method: data ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function account() {
  const response = await fetch(`${gateway}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `product-integrity-${randomUUID()}@example.test`,
      password: randomUUID(),
    }),
  });
  if (!response.ok) throw Error(`Synthetic signup failed: ${response.status}`);
  const session = await response.json();
  const first = await api(session.access_token, 'onboarding/turn', {
    workspaceId: null,
    requestId: randomUUID(),
    answer:
      'Synthetic product integrity first answer: we provide plumbing services.',
    allowAI: true,
  });
  if (
    first.status !== 200 ||
    !first.body.workspaceId ||
    first.body.facts.length < 2
  )
    throw Error(
      `Positive onboarding control failed: ${first.status} ${first.body.error?.code || 'missing facts'}`,
    );
  return {
    token: session.access_token,
    workspace: first.body.workspaceId,
    first: first.body,
  };
}
async function state(account) {
  const result = await api(
    account.token,
    `onboarding?workspaceId=${account.workspace}`,
  );
  if (result.status !== 200)
    throw Error(`GET onboarding failed: ${result.status}`);
  return result.body;
}
async function stored(workspace) {
  return (
    await pool.query(
      `select
    (select display_name from business_profiles where workspace_id=$1) name,
    (select onboarding_status from business_profiles where workspace_id=$1) profile_status,
    (select jsonb_agg(jsonb_build_object('field',field_path,'value',value,'state',fact_state) order by field_path) from business_profile_facts where workspace_id=$1) facts,
    (select count(*)::integer from audit_logs where workspace_id=$1 and event='onboarding.turn_saved') saved_turns,
    (select requests from rate_limits where workspace_id=$1 and operation='onboarding') rate_requests`,
      [workspace],
    )
  ).rows[0];
}
async function fault(table, workspace) {
  if (
    !['business_profiles', 'business_profile_facts'].includes(table) ||
    !/^[0-9a-f-]{36}$/.test(workspace)
  )
    throw Error('Invalid isolated fault target');
  await pool.query(`create function public.product_review_failure() returns trigger language plpgsql as $$begin
    if new.workspace_id='${workspace}'::uuid then raise exception 'synthetic scoped product review fault';end if;
    return new;end$$;
    create trigger product_review_fault before update on public.${table} for each row execute function public.product_review_failure()`);
  return async () =>
    pool.query(
      `drop trigger if exists product_review_fault on public.${table};drop function if exists public.product_review_failure()`,
    );
}

try {
  const confirmation = await account();
  const beforeConfirm = await state(confirmation);
  const beforeConfirmStored = await stored(confirmation.workspace);
  const removeConfirm = await fault(
    'business_profile_facts',
    confirmation.workspace,
  );
  try {
    const result = await api(confirmation.token, 'onboarding/confirm', {
      workspaceId: confirmation.workspace,
    });
    const after = await state(confirmation);
    const afterStored = await stored(confirmation.workspace);
    evidence.checks.push({
      name: 'failed fact confirmation preserves profile status',
      positiveControl: {
        firstAnswerStatus: 200,
        populatedFacts: beforeConfirm.facts.length,
      },
      status: result.status,
      error: result.body.error?.code,
      beforeStatus: beforeConfirm.onboardingStatus,
      afterStatus: after.onboardingStatus,
      profilePreserved:
        beforeConfirmStored.profile_status === afterStored.profile_status,
      factsPreserved:
        JSON.stringify(beforeConfirmStored.facts) ===
        JSON.stringify(afterStored.facts),
      pass:
        result.status === 503 &&
        beforeConfirm.onboardingStatus === after.onboardingStatus,
    });
  } finally {
    await removeConfirm();
  }

  const identity = await account();
  const beforeIdentity = await stored(identity.workspace);
  const removeIdentity = await fault('business_profiles', identity.workspace);
  try {
    const answer = 'The business name is called Synthetic New Business.';
    const requestId = randomUUID();
    const result = await api(identity.token, 'onboarding/turn', {
      workspaceId: identity.workspace,
      requestId,
      answer,
    });
    const after = await state(identity);
    const afterStored = await stored(identity.workspace);
    evidence.checks.push({
      name: 'failed identity change preserves old facts and new failed answer',
      positiveControl: {
        firstAnswerStatus: 200,
        populatedFacts: beforeIdentity.facts.length,
      },
      status: result.status,
      error: result.body.error?.code,
      factsBefore: beforeIdentity.facts.length,
      factsAfter: after.facts.length,
      profileNamePreserved: beforeIdentity.name === afterStored.name,
      factsPreserved:
        JSON.stringify(beforeIdentity.facts) ===
        JSON.stringify(afterStored.facts),
      actualFailedAnswerPreserved:
        after.messages.at(-1)?.id === requestId &&
        after.messages.at(-1)?.content === answer,
      pass:
        result.status === 503 &&
        JSON.stringify(beforeIdentity.facts) ===
          JSON.stringify(afterStored.facts) &&
        after.messages.at(-1)?.content === answer,
    });
  } finally {
    await removeIdentity();
  }

  const duplicate = await account();
  for (let iteration = 0; iteration < 3; iteration++) {
    const before = await stored(duplicate.workspace);
    const body = {
      workspaceId: duplicate.workspace,
      requestId: randomUUID(),
      answer: `Synthetic paired duplicate answer ${iteration}: plumbing maintenance.`,
    };
    const first = api(duplicate.token, 'onboarding/turn', body);
    const second = api(duplicate.token, 'onboarding/turn', body);
    const results = await Promise.all([first, second]);
    const after = await stored(duplicate.workspace);
    evidence.checks.push({
      name: `paired duplicate submission ${iteration + 1}`,
      statuses: results.map((result) => result.status),
      completedTurnDelta: after.saved_turns - before.saved_turns,
      rateRequestDelta: after.rate_requests - before.rate_requests,
      pass:
        after.saved_turns - before.saved_turns === 1 &&
        after.rate_requests - before.rate_requests === 1,
    });
  }
} catch (error) {
  evidence.error = error.message;
  process.exitCode = 2;
} finally {
  await pool.end();
  evidence.finishedAt = new Date().toISOString();
  evidence.failed = evidence.checks.filter((check) => !check.pass).length;
  writeFileSync(
    `evidence/http-onboarding-${phase}.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      phase,
      checks: evidence.checks.length,
      failed: evidence.failed,
      error: evidence.error || null,
    }),
  );
  if (evidence.failed && !process.exitCode) process.exitCode = 1;
}
