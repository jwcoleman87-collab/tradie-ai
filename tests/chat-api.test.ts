import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppError } from '../lib/server/errors';
import { api } from '../lib/server/api';

type Receipt = {
  error?: { code: string };
  messageSaved?: boolean;
  notice?: string;
};

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  runTeam: vi.fn(),
  provider: {
    usage: [],
    attempts: [
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        status: 'failed',
        errorCode: 'AI_TIMEOUT',
        httpStatus: 504,
      },
    ],
  },
}));
vi.mock('../lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/db')>()),
  adminDb: () => ({ from: mocks.from }),
  authenticate: async () => ({
    db: { from: mocks.from },
    user: { id: 'test-user' },
  }),
  membership: async () => 'owner',
  rpc: mocks.rpc,
}));
vi.mock('../lib/server/ai', () => ({ runTeam: mocks.runTeam }));
vi.mock('../lib/server/ai-provider', () => ({
  createAIProvider: () => mocks.provider,
}));
vi.mock('../lib/server/integration-api', () => ({
  integrationApi: async () => null,
}));
vi.mock('../lib/server/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/connections')>()),
  connectionList: async () => [],
}));

const runId = crypto.randomUUID();
const userMessageId = crypto.randomUUID();
const assistantMessage = {
  id: crypto.randomUUID(),
  role: 'assistant',
  content: 'Saved reply',
  run_id: runId,
  created_at: '2026-09-05T00:00:00.000Z',
  attachment_ids: [],
};
const input = {
  workspaceId: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  text: 'PRIVATE-CUSTOMER-TEXT',
  attachmentIds: [],
};
const writes: {
  table: string;
  operation: string;
  data: Record<string, unknown>;
  filters: unknown[];
}[] = [];
let consent = true;
let failTable = '';
let failureUpdateWon = true;
function query(table: string) {
  let operation = 'select';
  let data: Record<string, unknown> = {};
  const filters: unknown[] = [];
  const result = () => {
    if (operation !== 'select')
      writes.push({ table, operation, data, filters });
    if (table === failTable && operation !== 'select')
      return { data: null, error: new Error('PRIVATE-DATABASE-ERROR') };
    if (table === 'workspaces')
      return {
        data: {
          status: 'active',
          ai_consent_at: consent ? '2026-08-31' : null,
          time_zone: 'Australia/Sydney',
        },
        error: null,
      };
    if (table === 'conversations')
      return { data: { status: 'active' }, error: null };
    if (table === 'integration_credentials') return { data: null, error: null };
    if (table === 'messages')
      return {
        data: filters.some(
          (filter) => JSON.stringify(filter) === '["role","assistant"]',
        )
          ? assistantMessage
          : [{ role: 'user', content: input.text }],
        error: null,
      };
    if (table === 'agent_runs')
      return {
        data:
          operation === 'update'
            ? failureUpdateWon
              ? [{ id: runId }]
              : []
            : { error_code: 'AI_TIMEOUT' },
        error: null,
      };
    return { data: [], error: null };
  };
  const chain = {
    abortSignal: () => chain,
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: (...filter: unknown[]) => {
      filters.push(filter);
      return chain;
    },
    single: async () => result(),
    maybeSingle: async () => result(),
    update: (value: Record<string, unknown>) => {
      operation = 'update';
      data = value;
      return chain;
    },
    insert: (value: Record<string, unknown>) => {
      operation = 'insert';
      data = value;
      return chain;
    },
    // eslint-disable-next-line unicorn/no-thenable -- Match Supabase's awaitable query contract.
    then: (
      resolve: (value: ReturnType<typeof result>) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}
const send = (stream = false, signal?: AbortSignal) =>
  api(
    new Request('https://example.test/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(stream ? { Accept: 'application/x-ndjson' } : {}),
      },
      signal,
      body: JSON.stringify(input),
    }),
  );
beforeEach(() => {
  writes.length = 0;
  consent = true;
  failTable = '';
  failureUpdateWon = true;
  mocks.from.mockReset().mockImplementation(query);
  mocks.rpc
    .mockReset()
    .mockImplementation(async (_db, name) =>
      name === 'begin_chat'
        ? { id: runId, status: 'working', existing: false, userMessageId }
        : null,
    );
  mocks.runTeam.mockReset().mockResolvedValue({
    reply: 'Private response',
    agents: ['social'],
    versions: [],
    model: 'gpt-5-mini',
    usage: [],
    providerTrace: [],
    proposals: [],
    escalation: 'none',
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('returns a saved receipt only after the completed reply transaction', async () => {
  const response = await send();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    messageSaved: true,
    runId,
    status: 'completed',
    assistantMessage,
  });
  expect(mocks.rpc.mock.calls.map((call) => call[1])).toEqual([
    'begin_chat',
    'complete_chat',
  ]);
  expect(writes).toEqual([]);
});

it('streams durable acceptance before generation and exposes the reply only after atomic persistence', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  mocks.runTeam.mockReturnValue(pending);
  const response = await send(true);
  expect(response.headers.get('content-type')).toContain(
    'application/x-ndjson',
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  expect(JSON.parse(first)).toMatchObject({
    type: 'accepted',
    messageSaved: true,
    runId,
    userMessageId,
    requestId: input.requestId,
    status: 'working',
  });
  expect(mocks.rpc.mock.calls.some((call) => call[1] === 'complete_chat')).toBe(
    false,
  );
  finish({
    reply: 'Saved reply',
    agents: ['social'],
    versions: [],
    usage: [],
    providerTrace: [],
    proposals: [],
    escalation: 'none',
  });
  let remaining = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remaining += decoder.decode(chunk.value, { stream: true });
  }
  const events = remaining
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({
    type: 'completed',
    messageSaved: true,
    assistantMessage,
  });
  expect(
    mocks.rpc.mock.calls.filter((call) => call[1] === 'complete_chat'),
  ).toHaveLength(1);
});

it('cancels work after a disconnected accepted request without persisting late proposals', async () => {
  const cancellation = new AbortController();
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  mocks.runTeam.mockImplementation(() => {
    started();
    return new Promise(() => {});
  });
  const response = await send(true, cancellation.signal);
  await running;
  cancellation.abort();
  const events = (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events[0].type).toBe('accepted');
  expect(events.at(-1)).toMatchObject({
    type: 'failed',
    messageSaved: true,
    error: { code: 'AI_TIMEOUT' },
  });
  expect(mocks.rpc.mock.calls.some((call) => call[1] === 'complete_chat')).toBe(
    false,
  );
  expect(writes[0]).toMatchObject({
    table: 'agent_runs',
    data: { status: 'failed' },
  });
});

it('reads a durable status receipt scoped to the authenticated actor and workspace', async () => {
  mocks.rpc.mockResolvedValue({
    id: runId,
    status: 'completed',
    userMessageId,
    assistantMessage,
  });
  const response = await api(
    new Request(
      `https://example.test/api/chat/status?workspaceId=${input.workspaceId}&requestId=${input.requestId}`,
    ),
  );
  expect(await response.json()).toMatchObject({
    runId,
    userMessageId,
    messageSaved: true,
    assistantMessage,
    status: 'completed',
  });
  expect(mocks.rpc).toHaveBeenCalledWith(
    expect.anything(),
    'read_chat_receipt',
    {
      p_workspace: input.workspaceId,
      p_user: 'test-user',
      p_request: input.requestId,
    },
  );
  expect(mocks.runTeam).not.toHaveBeenCalled();
});

it('reports the committed reply when completion wins despite a lost commit acknowledgement', async () => {
  failureUpdateWon = false;
  mocks.rpc.mockImplementation(async (_db, name) => {
    if (name === 'begin_chat')
      return { id: runId, existing: false, status: 'working', userMessageId };
    if (name === 'complete_chat') throw new AppError('AI_TIMEOUT', 503);
    return {
      id: runId,
      status: 'completed',
      requestId: input.requestId,
      userMessageId,
      assistantMessage,
    };
  });
  expect(await (await send()).json()).toMatchObject({
    status: 'completed',
    messageSaved: true,
    assistantMessage,
  });
});
it('records a failed outcome and safe diagnostics and still acknowledges the saved message', async () => {
  mocks.runTeam.mockRejectedValue(
    new AppError('AI_TIMEOUT', 503, 'PRIVATE-PROVIDER-ERROR'),
  );
  const response = await send();
  const data = (await response.json()) as Receipt;
  expect(response.status).toBe(503);
  expect(data).toMatchObject({
    messageSaved: true,
    runId,
    status: 'failed',
    error: { code: 'AI_TIMEOUT' },
  });
  expect(writes.map((write) => write.table)).toEqual([
    'agent_runs',
    'audit_logs',
  ]);
  expect(writes[0]).toMatchObject({
    data: { status: 'failed', error_code: 'AI_TIMEOUT' },
    filters: [
      ['id', runId],
      ['status', 'working'],
    ],
  });
  expect(writes[1].data).toMatchObject({
    event: 'chat.failed',
    entity_id: runId,
    metadata: {
      error_code: 'AI_TIMEOUT',
      provider_trace: mocks.provider.attempts,
    },
  });
  expect(
    JSON.stringify({ data, writes, logs: vi.mocked(console.error).mock.calls }),
  ).not.toContain('PRIVATE');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it.each(['working', 'failed', 'completed'])(
  'replays an existing %s receipt without running AI or writing again',
  async (status) => {
    mocks.rpc.mockResolvedValue({ id: runId, status, existing: true });
    const response = await send();
    const data = (await response.json()) as Receipt;
    expect(data).toMatchObject({ messageSaved: true, runId, status });
    expect(response.status).toBe(status === 'working' ? 202 : 200);
    if (status === 'failed') expect(data.error?.code).toBe('AI_TIMEOUT');
    expect(mocks.runTeam).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  },
);
it('does not claim a message was saved when processing is disabled', async () => {
  consent = false;
  const response = await send();
  const data = (await response.json()) as Receipt;
  expect(response.status).toBe(403);
  expect(data.error?.code).toBe('AI_CONSENT_REQUIRED');
  expect(data.messageSaved).toBeUndefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['agent_runs', 'audit_logs'])(
  'keeps the receipt and original failure when %s persistence is unavailable',
  async (table) => {
    failTable = table;
    mocks.runTeam.mockRejectedValue(new AppError('AI_TIMEOUT', 503));
    const response = await send();
    expect(await response.json()).toMatchObject(
      table === 'agent_runs'
        ? {
            messageSaved: true,
            status: 'working',
            notice: expect.stringContaining('saved outcome'),
          }
        : {
            messageSaved: true,
            status: 'failed',
            error: { code: 'AI_TIMEOUT' },
          },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain(
      'chat_failure_persist_failed',
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      'PRIVATE',
    );
  },
);
it('does not relabel a committed reply as failed when Ask James case creation fails', async () => {
  failTable = 'escalation_cases';
  mocks.runTeam.mockResolvedValue({
    reply: 'Private response',
    agents: ['social'],
    versions: [],
    proposals: [],
    escalation: 'clarification',
  });
  const response = await send();
  const data = (await response.json()) as Receipt;
  expect(response.status).toBe(200);
  expect(data).toMatchObject({ messageSaved: true, status: 'completed' });
  expect(data.notice).toContain('Ask James case could not be created');
  expect(
    writes.some(
      (write) => write.table === 'agent_runs' || write.table === 'audit_logs',
    ),
  ).toBe(false);
});
