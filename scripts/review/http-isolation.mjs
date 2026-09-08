import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  pg,
  appOrigin,
  gatewayOrigin,
  evidenceRoot,
  readInfraConfig,
} from './review-env.mjs';

const base = appOrigin,
  gateway = gatewayOrigin;
const infrastructure = readInfraConfig();
const local = JSON.parse(
  readFileSync(`${evidenceRoot}/runtime/local-config.json`, 'utf8'),
);
const db = new pg.Client(infrastructure.database);
await db.connect();
const label =
  process.env.E2E_CANDIDATE_LABEL ||
  'baseline-api-f999413-with-local-SQL-001-002';
const stamp = Date.now();
const report = {
  label,
  startedAt: new Date().toISOString(),
  boundaries: {
    application: 'Real production-built Next.js HTTP API',
    database:
      'Real PostgreSQL18.4 and PostgREST16.2 with repository migrations',
    mocked: [
      'Supabase sign-up and session lookup',
      'Storage bytes and signed URL service',
      'AI provider response',
    ],
    externalActions:
      'No external action proposals; network preload rejects non-loopback calls except rerouted AI',
  },
  fixtures: [],
  checks: [],
  findings: [],
  unsupported: [
    'Conversation rename: no implemented route',
    'Generic record payload editing: no implemented route',
    'Editing record.create proposal: only facebook.publish has revision support; no Facebook side effects tested',
  ],
};
const fixtures = [];
const hash = (x) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
const tables = (
  await db.query(
    "select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id' and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE') order by table_name",
  )
).rows.map((x) => x.table_name);
const workspaceIds = () =>
  fixtures.flatMap((f) => [f.workspaceId, f.extraWorkspaceId].filter(Boolean));
async function snapshot() {
  const ids = workspaceIds();
  const all = {};
  all.workspaces = (
    await db.query(
      'select * from workspaces where id=any($1::uuid[]) order by id',
      [ids],
    )
  ).rows;
  for (const table of tables)
    all[table] = (
      await db.query(
        `select * from public."${table}" where workspace_id=any($1::uuid[]) order by to_jsonb("${table}")::text`,
        [ids],
      )
    ).rows;
  return {
    hash: hash(all),
    counts: Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, v.length]),
    ),
  };
}
async function request(actor, method, pathname, body, extra = {}) {
  const headers = { Authorization: `Bearer ${actor.token}`, ...extra };
  if (body !== undefined && !extra['Content-Type'])
    headers['Content-Type'] = 'application/json';
  const response = await fetch(base + '/api' + pathname, {
    method,
    headers,
    ...(body === undefined
      ? {}
      : { body: extra['Content-Type'] ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}
async function good(actor, method, p, b, expected = 200, extra = {}) {
  const r = await request(actor, method, p, b, extra);
  try {
    assert.equal(
      r.status,
      expected,
      `${actor.label} positive ${method} ${p}: ${r.status} ${r.text}`,
    );
  } catch (error) {
    error.positiveControlFailed = true;
    throw error;
  }
  return r;
}
async function check(name, fn) {
  const started = Date.now();
  try {
    const evidence = await fn();
    report.checks.push({
      name,
      status: 'passed',
      durationMs: Date.now() - started,
      ...evidence,
    });
  } catch (error) {
    const finding = {
      name,
      status: error.positiveControlFailed ? 'blocked' : 'failed',
      category: error.positiveControlFailed
        ? 'Owner positive control failed; foreign check not exercised'
        : 'Unexpected negative-test outcome',
      message: error.message,
      durationMs: Date.now() - started,
      ...error.evidence,
    };
    report.checks.push(finding);
    report.findings.push(finding);
    console.log(JSON.stringify({ finding: name, message: error.message }));
  }
}
async function negative(attacker, victim, name, method, p, body, extra = {}) {
  const before = await snapshot();
  const result = await request(attacker, method, p, body, extra);
  const after = await snapshot();
  const forbidden = [
    victim.marker,
    victim.workspaceId,
    victim.extraWorkspaceId,
    victim.conversationId,
    victim.managementConversationId,
    victim.fileId,
    victim.recordId,
    victim.actionId,
    victim.waitingActionId,
    victim.objectPath,
    victim.userId,
    victim.caseId,
  ].filter(Boolean);
  const leaked = forbidden.filter((x) => result.text.includes(x));
  const evidence = {
    direction: `${attacker.label} -> ${victim.label}`,
    method,
    path: p,
    statusCode: result.status,
    errorCode: result.data?.error?.code || result.data?.code,
    dbUnchanged: before.hash === after.hash,
    leakedForeignMarkers: leaked.length,
    beforeHash: before.hash,
    afterHash: after.hash,
  };
  try {
    assert.equal(
      before.hash,
      after.hash,
      `${name}: negative request changed tenant database rows`,
    );
    assert.equal(
      leaked.length,
      0,
      `${name}: response leaked foreign identifiers/content`,
    );
    assert.ok(
      [403, 404].includes(result.status),
      `${name}: expected authorised route to deny foreign access with403/404, got${result.status} ${result.text}`,
    );
  } catch (error) {
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}
async function state(f) {
  return (
    await good(
      f,
      'GET',
      `/state?workspaceId=${f.workspaceId}&conversationId=${f.conversationId}`,
    )
  ).data;
}
async function makeActor(name) {
  const marker = `HTTP_PRIVATE_${name}_${stamp}`;
  const response = await fetch(gateway + '/auth/v1/signup', {
    method: 'POST',
    headers: { apikey: local.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `http-isolation-${name.toLowerCase()}-${stamp}@example.invalid`,
      password: 'Synthetic-only-password-2026!',
    }),
  });
  assert.equal(response.status, 200);
  const auth = await response.json();
  const f = {
    label: name,
    marker,
    token: auth.access_token,
    userId: auth.user.id,
  };
  fixtures.push(f);
  f.workspaceId = (
    await good(f, 'POST', '/bootstrap', { name: marker })
  ).data.workspaceId;
  let s = (await good(f, 'GET', `/state?workspaceId=${f.workspaceId}`)).data;
  f.conversationId = s.conversationId;
  await good(f, 'POST', '/onboarding/turn', {
    workspaceId: f.workspaceId,
    requestId: randomUUID(),
    answer: `${name === 'B' ? 'Synthetic B Plumbing' : 'Synthetic A Plumbing'} ${marker} review`,
    allowAI: true,
  });
  await good(f, 'PATCH', '/onboarding/profile', {
    workspaceId: f.workspaceId,
    facts: [
      { fieldPath: 'display_name', value: marker },
      { fieldPath: 'base_location', value: `Private location ${marker}` },
    ],
  });
  await good(f, 'POST', '/onboarding/confirm', { workspaceId: f.workspaceId });
  await good(f, 'POST', '/consent', {
    workspaceId: f.workspaceId,
    allowAI: true,
  });
  f.extraWorkspaceId = (
    await good(
      f,
      'POST',
      '/workspaces',
      { name: `Management ${marker}`, workspaceType: 'sandbox' },
      201,
    )
  ).data.id;
  f.managementConversationId = (
    await good(
      f,
      'POST',
      '/conversations',
      {
        workspaceId: f.workspaceId,
        title: `Management conversation ${marker}`,
      },
      201,
    )
  ).data.id;
  const upload = await good(
    f,
    'POST',
    `/uploads?workspaceId=${f.workspaceId}&conversationId=${f.conversationId}&filename=${marker}.txt`,
    `SYNTHETIC_ATTACHMENT_MARKER ${marker}`,
    201,
    { 'Content-Type': 'text/plain' },
  );
  f.fileId = upload.data.id;
  f.objectPath = (
    await db.query('select object_path from uploaded_files where id=$1', [
      f.fileId,
    ])
  ).rows[0].object_path;
  f.requestId = randomUUID();
  await good(f, 'POST', '/chat', {
    workspaceId: f.workspaceId,
    conversationId: f.conversationId,
    requestId: f.requestId,
    text: `SYNTHETIC_PROPOSAL ${marker} first`,
    attachmentIds: [],
  });
  s = await state(f);
  f.deniedActionId = s.actions.find((a) => a.status === 'waiting_approval').id;
  const recordCount = s.records.length;
  await good(f, 'POST', `/actions/${f.deniedActionId}/decision`, {
    decision: 'deny',
  });
  s = await state(f);
  assert.equal(s.records.length, recordCount);
  assert.equal(
    s.actions.find((a) => a.id === f.deniedActionId).status,
    'denied',
  );
  report.checks.push({
    name: `${name} denial creates no record`,
    status: 'passed',
    recordCount,
  });
  await good(f, 'POST', '/chat', {
    workspaceId: f.workspaceId,
    conversationId: f.conversationId,
    requestId: randomUUID(),
    text: `SYNTHETIC_PROPOSAL ${marker} second`,
    attachmentIds: [],
  });
  s = await state(f);
  f.actionId = s.actions.find((a) => a.status === 'waiting_approval').id;
  const approvedPayload = (
    await db.query('select payload from proposed_actions where id=$1', [
      f.actionId,
    ])
  ).rows[0].payload;
  await good(f, 'POST', `/actions/${f.actionId}/decision`, {
    decision: 'accept',
  });
  await good(f, 'POST', `/actions/${f.actionId}/decision`, {
    decision: 'accept',
  });
  await good(f, 'POST', `/actions/${f.actionId}/execute`, {});
  const records = (
    await db.query('select * from business_records where action_id=$1', [
      f.actionId,
    ])
  ).rows;
  assert.equal(records.length, 1);
  f.recordId = records[0].id;
  assert.equal(records[0].title, approvedPayload.title);
  assert.equal(records[0].body, approvedPayload.body);
  assert.equal(records[0].kind, approvedPayload.kind);
  const executions = (
    await db.query('select * from action_executions where action_id=$1', [
      f.actionId,
    ])
  ).rows;
  assert.equal(executions.length, 1);
  report.checks.push({
    name: `${name} exact approved payload executes once after decision/execute replay`,
    status: 'passed',
    records: records.length,
    executions: executions.length,
    payloadHash: hash(approvedPayload),
  });
  await good(f, 'POST', '/chat', {
    workspaceId: f.workspaceId,
    conversationId: f.conversationId,
    requestId: randomUUID(),
    text: `Use attachment ${marker}`,
    attachmentIds: [f.fileId],
  });
  s = await state(f);
  for (const a of s.actions.filter((a) => a.status === 'waiting_approval'))
    await good(f, 'POST', `/actions/${a.id}/decision`, { decision: 'deny' });
  const signed = (await good(f, 'GET', `/uploads/${f.fileId}/url`)).data;
  const signedUrl = signed.signedUrl || signed.signedURL;
  assert.equal(new URL(signedUrl).hostname, '127.0.0.1');
  const download = await fetch(signedUrl);
  assert.equal(download.status, 200);
  assert.ok((await download.text()).includes(marker));
  report.checks.push({
    name: `${name} authorised upload, attachment use and signed download`,
    status: 'passed',
    fileId: f.fileId,
  });
  await good(f, 'POST', '/chat', {
    workspaceId: f.workspaceId,
    conversationId: f.conversationId,
    requestId: randomUUID(),
    text: `SYNTHETIC_PROPOSAL ${marker} remain pending for foreign-access attempts`,
    attachmentIds: [],
  });
  s = await state(f);
  f.waitingActionId = s.actions.find((a) => a.status === 'waiting_approval').id;
  f.caseId = (
    await good(
      f,
      'POST',
      '/cases',
      {
        workspaceId: f.workspaceId,
        conversationId: f.conversationId,
        agent: 'maintenance',
        category: 'general',
        problem: `Private test case ${marker}`,
        shareWithSupport: false,
      },
      201,
    )
  ).data;
  if (typeof f.caseId === 'object') f.caseId = f.caseId.id;
  report.fixtures.push({
    label: f.label,
    userId: f.userId,
    workspaceId: f.workspaceId,
    conversationId: f.conversationId,
    fileId: f.fileId,
    recordId: f.recordId,
    actionId: f.actionId,
    marker: f.marker,
  });
  return f;
}
try {
  const A = await makeActor('A');
  const B = await makeActor('B');
  for (const [attacker, victim] of [
    [A, B],
    [B, A],
  ]) {
    const d = `${attacker.label}->${victim.label}`;
    await check(`${d} state foreign workspace`, async () => {
      await state(victim);
      return negative(
        attacker,
        victim,
        'state',
        'GET',
        `/state?workspaceId=${victim.workspaceId}`,
      );
    });
    await check(
      `${d} state foreign conversation under own workspace`,
      async () => {
        await state(victim);
        return negative(
          attacker,
          victim,
          'state-conversation',
          'GET',
          `/state?workspaceId=${attacker.workspaceId}&conversationId=${victim.conversationId}`,
        );
      },
    );
    await check(`${d} onboarding read`, async () => {
      await good(
        victim,
        'GET',
        `/onboarding?workspaceId=${victim.workspaceId}`,
      );
      return negative(
        attacker,
        victim,
        'onboarding',
        'GET',
        `/onboarding?workspaceId=${victim.workspaceId}`,
      );
    });
    await check(`${d} onboarding turn`, async () => {
      await good(victim, 'POST', '/onboarding/turn', {
        workspaceId: victim.workspaceId,
        requestId: randomUUID(),
        answer: `Owner continuing ${victim.marker}`,
        allowAI: true,
      });
      return negative(
        attacker,
        victim,
        'onboarding-turn',
        'POST',
        '/onboarding/turn',
        {
          workspaceId: victim.workspaceId,
          requestId: randomUUID(),
          answer: 'Foreign injection',
          allowAI: true,
        },
      );
    });
    await check(`${d} profile correction`, async () => {
      await good(victim, 'PATCH', '/onboarding/profile', {
        workspaceId: victim.workspaceId,
        facts: [
          {
            fieldPath: 'base_location',
            value: `Owner location ${victim.marker}`,
          },
        ],
      });
      return negative(
        attacker,
        victim,
        'profile',
        'PATCH',
        '/onboarding/profile',
        {
          workspaceId: victim.workspaceId,
          facts: [{ fieldPath: 'base_location', value: 'Foreign location' }],
        },
      );
    });
    await check(`${d} profile confirmation`, async () => {
      await good(victim, 'POST', '/onboarding/confirm', {
        workspaceId: victim.workspaceId,
      });
      return negative(
        attacker,
        victim,
        'confirm',
        'POST',
        '/onboarding/confirm',
        { workspaceId: victim.workspaceId },
      );
    });
    await check(`${d} consent`, async () => {
      await good(victim, 'POST', '/consent', {
        workspaceId: victim.workspaceId,
        allowAI: true,
      });
      return negative(attacker, victim, 'consent', 'POST', '/consent', {
        workspaceId: victim.workspaceId,
        allowAI: false,
      });
    });
    await check(`${d} workspace rename`, async () => {
      await good(victim, 'PATCH', `/workspaces/${victim.extraWorkspaceId}`, {
        name: `Owner renamed ${victim.marker}`,
        workspaceType: 'sandbox',
      });
      return negative(
        attacker,
        victim,
        'rename',
        'PATCH',
        `/workspaces/${victim.extraWorkspaceId}`,
        { name: 'Foreign renamed', workspaceType: 'sandbox' },
      );
    });
    await check(`${d} workspace archive/restore`, async () => {
      await good(
        victim,
        'PATCH',
        `/workspaces/${victim.extraWorkspaceId}/status`,
        { status: 'archived' },
      );
      await good(
        victim,
        'PATCH',
        `/workspaces/${victim.extraWorkspaceId}/status`,
        { status: 'active' },
      );
      return negative(
        attacker,
        victim,
        'workspace-status',
        'PATCH',
        `/workspaces/${victim.extraWorkspaceId}/status`,
        { status: 'archived' },
      );
    });
    await check(`${d} conversation create`, async () => {
      await good(
        victim,
        'POST',
        '/conversations',
        { workspaceId: victim.workspaceId, title: `Owner positive ${stamp}` },
        201,
      );
      return negative(
        attacker,
        victim,
        'conversation-create',
        'POST',
        '/conversations',
        { workspaceId: victim.workspaceId, title: 'Foreign conversation' },
      );
    });
    await check(`${d} conversation archive/restore`, async () => {
      await good(
        victim,
        'PATCH',
        `/conversations/${victim.managementConversationId}/status`,
        { workspaceId: victim.workspaceId, status: 'archived' },
      );
      await good(
        victim,
        'PATCH',
        `/conversations/${victim.managementConversationId}/status`,
        { workspaceId: victim.workspaceId, status: 'active' },
      );
      return negative(
        attacker,
        victim,
        'conversation-status',
        'PATCH',
        `/conversations/${victim.managementConversationId}/status`,
        { workspaceId: victim.workspaceId, status: 'archived' },
      );
    });
    await check(`${d} mixed-tenant conversation status`, () =>
      negative(
        attacker,
        victim,
        'conversation-mixed',
        'PATCH',
        `/conversations/${victim.managementConversationId}/status`,
        { workspaceId: attacker.workspaceId, status: 'archived' },
      ),
    );
    await check(`${d} record archive/restore`, async () => {
      await good(victim, 'PATCH', `/records/${victim.recordId}/status`, {
        workspaceId: victim.workspaceId,
        status: 'archived',
      });
      await good(victim, 'PATCH', `/records/${victim.recordId}/status`, {
        workspaceId: victim.workspaceId,
        status: 'active',
      });
      return negative(
        attacker,
        victim,
        'record-status',
        'PATCH',
        `/records/${victim.recordId}/status`,
        { workspaceId: victim.workspaceId, status: 'archived' },
      );
    });
    await check(`${d} mixed-tenant record status`, () =>
      negative(
        attacker,
        victim,
        'record-mixed',
        'PATCH',
        `/records/${victim.recordId}/status`,
        { workspaceId: attacker.workspaceId, status: 'archived' },
      ),
    );
    await check(`${d} chat receipt`, async () => {
      await good(
        victim,
        'GET',
        `/chat/status?workspaceId=${victim.workspaceId}&requestId=${victim.requestId}`,
      );
      return negative(
        attacker,
        victim,
        'receipt',
        'GET',
        `/chat/status?workspaceId=${victim.workspaceId}&requestId=${victim.requestId}`,
      );
    });
    await check(`${d} mixed-tenant chat receipt`, () =>
      negative(
        attacker,
        victim,
        'receipt-mixed',
        'GET',
        `/chat/status?workspaceId=${attacker.workspaceId}&requestId=${victim.requestId}`,
      ),
    );
    await check(`${d} chat foreign workspace`, () =>
      negative(attacker, victim, 'chat', 'POST', '/chat', {
        workspaceId: victim.workspaceId,
        conversationId: victim.conversationId,
        requestId: randomUUID(),
        text: 'Foreign message',
        attachmentIds: [],
      }),
    );
    await check(`${d} chat foreign conversation under own workspace`, () =>
      negative(attacker, victim, 'chat-conversation', 'POST', '/chat', {
        workspaceId: attacker.workspaceId,
        conversationId: victim.conversationId,
        requestId: randomUUID(),
        text: 'Foreign conversation message',
        attachmentIds: [],
      }),
    );
    await check(`${d} attach foreign file`, () =>
      negative(attacker, victim, 'attach', 'POST', '/chat', {
        workspaceId: attacker.workspaceId,
        conversationId: attacker.conversationId,
        requestId: randomUUID(),
        text: 'Foreign attachment',
        attachmentIds: [victim.fileId],
      }),
    );
    await check(`${d} upload foreign workspace`, () =>
      negative(
        attacker,
        victim,
        'upload',
        'POST',
        `/uploads?workspaceId=${victim.workspaceId}&conversationId=${victim.conversationId}&filename=foreign.txt`,
        'Foreign bytes',
        { 'Content-Type': 'text/plain' },
      ),
    );
    await check(`${d} upload foreign conversation under own workspace`, () =>
      negative(
        attacker,
        victim,
        'upload-mixed',
        'POST',
        `/uploads?workspaceId=${attacker.workspaceId}&conversationId=${victim.conversationId}&filename=foreign.txt`,
        'Foreign bytes',
        { 'Content-Type': 'text/plain' },
      ),
    );
    await check(`${d} download foreign file`, async () => {
      await good(victim, 'GET', `/uploads/${victim.fileId}/url`);
      return negative(
        attacker,
        victim,
        'download',
        'GET',
        `/uploads/${victim.fileId}/url`,
      );
    });
    await check(`${d} deny foreign pending action`, async () => {
      await good(victim, 'POST', `/actions/${victim.deniedActionId}/decision`, {
        decision: 'deny',
      });
      return negative(
        attacker,
        victim,
        'deny',
        'POST',
        `/actions/${victim.waitingActionId}/decision`,
        { decision: 'deny' },
      );
    });
    await check(`${d} approve foreign pending action`, async () => {
      await good(victim, 'POST', `/actions/${victim.actionId}/decision`, {
        decision: 'accept',
      });
      return negative(
        attacker,
        victim,
        'approve',
        'POST',
        `/actions/${victim.waitingActionId}/decision`,
        { decision: 'accept' },
      );
    });
    await check(`${d} execute foreign action`, async () => {
      await good(victim, 'POST', `/actions/${victim.actionId}/execute`, {});
      return negative(
        attacker,
        victim,
        'execute',
        'POST',
        `/actions/${victim.actionId}/execute`,
        {},
      );
    });
    await check(`${d} case resolution`, async () => {
      await good(victim, 'PATCH', `/cases/${victim.caseId}`, {
        solution: 'Owner synthetic solution',
        outcome: 'Owner synthetic outcome',
      });
      return negative(
        attacker,
        victim,
        'case',
        'PATCH',
        `/cases/${victim.caseId}`,
        { solution: 'Foreign solution', outcome: 'Foreign outcome' },
      );
    });
  }
  for (const actor of fixtures)
    await check(
      `${actor.label} foreign attempts leave pending action untouched and owner can deny`,
      async () => {
        const pending = (
          await db.query('select status from proposed_actions where id=$1', [
            actor.waitingActionId,
          ])
        ).rows[0];
        assert.equal(pending.status, 'waiting_approval');
        await good(
          actor,
          'POST',
          `/actions/${actor.waitingActionId}/decision`,
          { decision: 'deny' },
        );
        assert.equal(
          (
            await db.query(
              'select count(*)::int n from business_records where action_id=$1',
              [actor.waitingActionId],
            )
          ).rows[0].n,
          0,
        );
        return { statusBeforeOwnerDenial: pending.status, recordsCreated: 0 };
      },
    );
} catch (error) {
  report.findings.push({
    name: 'Fixture setup or execution blocker',
    status: 'blocked',
    message: error.message,
  });
  console.log(JSON.stringify({ blocked: error.message }));
} finally {
  report.finishedAt = new Date().toISOString();
  report.totals = {
    passed: report.checks.filter((x) => x.status === 'passed').length,
    failed: report.checks.filter((x) => x.status === 'failed').length,
    blocked: report.findings.filter((x) => x.status === 'blocked').length,
  };
  report.tenantSnapshot = await snapshot();
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(
    `${evidenceRoot}/http-isolation-${label}.json`,
    JSON.stringify(report, null, 2),
  );
  await db.end();
  console.log(
    JSON.stringify({
      label,
      totals: report.totals,
      evidence: `${evidenceRoot}/http-isolation-${label}.json`,
    }),
  );
  if (report.totals.failed || report.totals.blocked) process.exitCode = 1;
}
