import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from '../../../e2e-tooling-20260908/node_modules/pg/lib/index.js';
const origin = 'http://127.0.0.1:3108',
  gateway = 'http://127.0.0.1:55441';
const config = JSON.parse(
  readFileSync('../e2e-tooling-20260908/infra-config.json', 'utf8'),
);
const db = new pg.Client(config.database);
await db.connect();
const results = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const control = (body) =>
  fetch(`${gateway}/review/control`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
const events = async () =>
  (await (await fetch(`${gateway}/review/control`)).json()).events;
async function until(fn, limit = 6000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    const value = await fn();
    if (value) return value;
    await pause(30);
  }
  throw Error('Timed out waiting for runtime observation');
}
async function step(name, run) {
  try {
    results.push({ name, status: 'passed', evidence: await run() });
  } catch (error) {
    results.push({ name, status: 'failed', error: error.message });
  }
  writeFileSync(
    'evidence/runtime-recovery.json',
    JSON.stringify(
      {
        boundaries:
          'Real built app/HTTP/PostgreSQL; synthetic auth/storage/AI transport',
        results,
      },
      null,
      2,
    ),
  );
}
const signup = await (
  await fetch(`${gateway}/auth/v1/signup`, {
    method: 'POST',
    body: JSON.stringify({
      email: `runtime-${randomUUID()}@example.invalid`,
      password: 'SyntheticRuntimeOnly123',
    }),
  })
).json();
const token = signup.access_token;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const boot = await api('bootstrap', 'POST', {
  name: 'Synthetic runtime account',
});
const workspaceId = boot.body.workspaceId;
await api('consent', 'POST', {
  workspaceId,
  allowAI: true,
  primaryProvider: 'openai',
  allowedProviders: ['openai'],
  allowFallback: false,
});
const newConversation = async () =>
  (
    await api('conversations', 'POST', {
      workspaceId,
      title: `Synthetic runtime ${randomUUID()}`,
    })
  ).body.id;
let conversationId = (await api(`state?workspaceId=${workspaceId}`)).body
  .conversationId;
await step(
  'Working conversation retains its slot; replay does not duplicate provider work; completion releases slot',
  async () => {
    await control({ reset: true, mode: 'success', delayMs: 250 });
    const requestId = randomUUID();
    const body = {
      workspaceId,
      conversationId,
      requestId,
      text: 'Synthetic runtime concurrency',
      attachmentIds: [],
    };
    const first = api('chat', 'POST', body);
    await until(async () =>
      (await events()).some((e) => e.kind === 'routing' && !e.endedAt),
    );
    const replay = await api('chat', 'POST', body);
    const second = await api('chat', 'POST', {
      ...body,
      requestId: randomUUID(),
      text: 'Synthetic conflicting request',
    });
    if (replay.status !== 202 || second.status !== 409)
      throw Error(
        `Expected202 replay/409 busy, got${replay.status}/${second.status}`,
      );
    const finish = await first;
    if (finish.body.status !== 'completed')
      throw Error('First did not complete');
    const counts = await db.query(
      'select count(*)::int runs from agent_runs where workspace_id=$1 and request_id=$2',
      [workspaceId, requestId],
    );
    const calls = await events();
    if (calls.length !== 2 || counts.rows[0].runs !== 1)
      throw Error(
        `Duplicated provider work or run: ${calls.length}/${counts.rows[0].runs}`,
      );
    await control({ delayMs: 0 });
    const next = await api('chat', 'POST', {
      ...body,
      requestId: randomUUID(),
      text: 'Synthetic after completion',
    });
    if (next.body.status !== 'completed')
      throw Error('Slot not released after completion');
    return {
      inFlightReplay: replay.status,
      competingRequest: second.status,
      modelCalls: calls.length,
      runCount: counts.rows[0].runs,
      nextCompleted: true,
    };
  },
);
await step(
  'Actual stream disconnect cancels local provider transport and persists terminal work',
  async () => {
    conversationId = await newConversation();
    await control({ reset: true, mode: 'success', delayMs: 800 });
    const requestId = randomUUID(),
      abort = new AbortController();
    const body = {
      workspaceId,
      conversationId,
      requestId,
      text: 'Synthetic stream interruption',
      attachmentIds: [],
    };
    const response = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
        origin,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const reader = response.body.getReader();
    const initial = await reader.read();
    const accepted = new TextDecoder().decode(initial.value);
    if (!accepted.includes('accepted'))
      throw Error('No accepted NDJSON receipt');
    await until(async () => (await events()).some((e) => !e.endedAt));
    const disconnectedAt = Date.now();
    abort.abort();
    await reader.cancel().catch(() => {});
    const state = await until(async () => {
      const row = (
        await db.query(
          'select status,error_code from agent_runs where workspace_id=$1 and request_id=$2',
          [workspaceId, requestId],
        )
      ).rows[0];
      return row && row.status !== 'working' ? row : null;
    });
    const stopped = await until(async () => {
      const list = await events();
      return list.length && list.every((e) => e.endedAt) ? list : null;
    });
    const elapsed = Date.now() - disconnectedAt;
    if (
      state.status !== 'failed' ||
      !stopped.some((e) => e.aborted) ||
      elapsed >= 1000
    )
      throw Error(
        `Disconnect cancellation not distinguished from timeout: ${JSON.stringify({ state, elapsed, stopped })}`,
      );
    await control({ delayMs: 0 });
    const next = await api('chat', 'POST', {
      ...body,
      requestId: randomUUID(),
      text: 'Synthetic after actual disconnect',
    });
    if (next.body.status !== 'completed')
      throw Error('Cancelled slot did not recover');
    return {
      receipt: state,
      elapsedMs: elapsed,
      localProviderTransportAborted: true,
      subsequentCompleted: true,
      limitation:
        'Does not prove a real remote provider stops billing or computation',
    };
  },
);
await step(
  'Chat burst rejection never reaches provider; second workspace has an independent bucket',
  async () => {
    await control({ reset: true, mode: 'success', delayMs: 0 });
    const fresh = (
      await api('workspaces', 'POST', {
        name: 'Synthetic quota workspace',
        workspaceType: 'sandbox',
      })
    ).body.id;
    await api('consent', 'POST', {
      workspaceId: fresh,
      allowAI: true,
      allowFallback: false,
    });
    const conversation = (await api(`state?workspaceId=${fresh}`)).body
      .conversationId;
    const startMinute = Math.floor(Date.now() / 60000);
    const accepted = [];
    for (let i = 0; i < 12; i++) {
      const r = await api('chat', 'POST', {
        workspaceId: fresh,
        conversationId: conversation,
        requestId: randomUUID(),
        text: `Synthetic quota accepted ${i}`,
        attachmentIds: [],
      });
      accepted.push(r.status);
      if (r.body.status !== 'completed')
        throw Error(`Request ${i} failed: ${JSON.stringify(r)}`);
    }
    const before = (await events()).length;
    const rejected = await api('chat', 'POST', {
      workspaceId: fresh,
      conversationId: conversation,
      requestId: randomUUID(),
      text: 'SYNTHETIC_REJECTED_DRAFT',
      attachmentIds: [],
    });
    if (startMinute !== Math.floor(Date.now() / 60000))
      throw Error(
        'Clock crossed real fixed-minute boundary; burst assertion inconclusive',
      );
    if (rejected.status !== 429 || (await events()).length !== before)
      throw Error('Burst ceiling bypass or provider called on rejection');
    const second = (
      await api('workspaces', 'POST', {
        name: 'Synthetic second quota workspace',
        workspaceType: 'sandbox',
      })
    ).body.id;
    await api('consent', 'POST', {
      workspaceId: second,
      allowAI: true,
      allowFallback: false,
    });
    const c2 = (await api(`state?workspaceId=${second}`)).body.conversationId;
    const other = await api('chat', 'POST', {
      workspaceId: second,
      conversationId: c2,
      requestId: randomUUID(),
      text: 'Synthetic same account second bucket',
      attachmentIds: [],
    });
    if (other.body.status !== 'completed')
      throw Error('Independent workspace bucket did not accept');
    return {
      accepted: accepted.length,
      rejectedStatus: rejected.status,
      rejectedMessage: rejected.body.error?.message,
      providerCallsOnRejection: 0,
      sameAccountOtherWorkspaceAccepted: true,
      accountWideCeiling: 'Absent',
      rejectedDraft: 'Client responsibility; browser draft assertion separate',
    };
  },
);
await control({ mode: 'success', delayMs: 0 });
await db.end();
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some((r) => r.status === 'failed') ? 1 : 0;
