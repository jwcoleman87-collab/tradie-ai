import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ManagerRuntime,
  authorityDecision,
} from '../lib/server/manager/runtime';
import type {
  ManagerModelAdapter,
  ManagerTurnInput,
  ManagerTurnResult,
  ToolDefinition,
} from '../lib/server/manager/contracts';
import {
  ResponsesManagerAdapter,
  AnthropicManagerAdapter,
  FallbackManagerAdapter,
  createManagerAdapter,
  aggregateManagerUsage,
} from '../lib/server/manager/adapters';
import { AppError } from '../lib/server/errors';
import { managerEnabled } from '../lib/server/manager/config';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const answer = {
  reply: 'Facebook access needs attention.',
  escalation: 'none' as const,
  attention: 'contained' as const,
  shortcut: 'facebook_connection' as const,
};
const tool: ToolDefinition = {
  name: 'connections.list',
  description: 'Read workspace connections',
  input: z.object({}).strict(),
  output: z.object({ status: z.string() }).strict(),
  workspaceScope: 'current',
  consequence: 'read',
  readOnly: true,
  reversible: true,
  authority: 'owner',
  provenance: 'observed',
};
const input = () => ({
  instructions: 'Inspect live state before answering.',
  messages: [
    { role: 'user' as const, content: 'Which Facebook page is selected?' },
  ],
  context: { role: 'owner' },
  signal: AbortSignal.timeout(5000),
});
const adapterInput = (): ManagerTurnInput => ({
  ...input(),
  tools: [tool],
  results: [],
  maxOutputTokens: 3500,
});
class FakeAdapter implements ManagerModelAdapter {
  readonly version = 'fake-v1';
  readonly usage = [];
  readonly attempts = [];
  readonly seen: ManagerTurnInput[] = [];
  constructor(
    readonly provider: string,
    readonly model: string,
    private turns: ManagerTurnResult[],
  ) {}
  async runTurn(value: ManagerTurnInput) {
    this.seen.push({ ...value, results: structuredClone(value.results) });
    return this.turns.shift()!;
  }
}
const request = (
  name = 'connections.list',
  args: unknown = {},
): ManagerTurnResult => ({
  kind: 'tools',
  calls: [{ id: crypto.randomUUID(), name, arguments: args }],
});
const final: ManagerTurnResult = { kind: 'final', answer };

it('keeps ancillary model usage within the existing two-provider storage contract', () => {
  const row = { inputTokens: 10, outputTokens: 20, totalTokens: 30 };
  const usage = aggregateManagerUsage([
    { ...row, provider: 'openai', model: 'gpt-6-astra' },
    { ...row, provider: 'openai', model: 'other-openai-model' },
    { ...row, provider: 'anthropic', model: 'claude-test' },
  ]);
  expect(usage).toHaveLength(2);
  expect(usage[0]).toMatchObject({
    totalTokens: 60,
    model: 'gpt-6-astra,other-openai-model',
  });
});

it('withholds an oversized tool result from the next model turn', async () => {
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), final]),
    {
      definitions: [tool],
      invoke: async () => ({ status: 'x'.repeat(25000) }),
    },
  );
  await runtime.run(input());
  expect(runtime.results[0]).toMatchObject({
    ok: false,
    errorCode: 'MANAGER_OUTPUT_TOO_LARGE',
  });
  expect(runtime.results[0].evidence).toBeUndefined();
});

it.each([
  ['openai', 'gpt-6-astra'],
  ['fable', 'fable-19'],
])(
  'runs the SAME tools and policy through %s / %s',
  async (provider, model) => {
    const adapter = new FakeAdapter(provider, model, [request(), final]);
    const invoke = vi.fn().mockResolvedValue({ status: 'reconnect_required' });
    const runtime = new ManagerRuntime(adapter, {
      definitions: [tool],
      invoke,
    });
    const result = await runtime.run(input());
    expect(result.answer).toEqual(answer);
    expect(invoke).toHaveBeenCalledOnce();
    expect(adapter.seen[1].results[0]).toMatchObject({
      ok: true,
      evidence: { status: 'reconnect_required' },
    });
    expect(adapter.seen[0].context.runtimeIdentity).toMatchObject({
      provider,
      model,
    });
    expect(runtime.toolTrace).toMatchObject([
      {
        name: 'connections.list',
        status: 'completed',
        approvalRequired: false,
      },
    ]);
  },
);
it.each(['sql.execute', 'http.fetch', 'actions.execute', 'unknown'])(
  'denies undeclared %s without execution or unsafe trace names',
  async (name) => {
    const adapter = new FakeAdapter('fable', 'fable-19', [
      request(name, { url: 'https://evil.test', sql: 'select *' }),
      final,
    ]);
    const invoke = vi.fn();
    const runtime = new ManagerRuntime(adapter, {
      definitions: [tool],
      invoke,
    });
    await runtime.run(input());
    expect(invoke).not.toHaveBeenCalled();
    expect(runtime.toolTrace[0]).toMatchObject({
      name: 'undeclared_tool',
      status: 'denied',
      errorCode: 'MANAGER_TOOL_UNDECLARED',
    });
    expect(JSON.stringify(runtime.toolTrace)).not.toMatch(/evil|select \*/);
  },
);
it('fails closed on extra workspace arguments and invalid output contracts', async () => {
  const adapter = new FakeAdapter('fable', 'fable-19', [
    request(undefined, { workspace_id: crypto.randomUUID() }),
    request(),
    final,
  ]);
  const invoke = vi.fn().mockResolvedValue({
    status: 'connected',
    secret: 'secret-should-not-leak',
  });
  const runtime = new ManagerRuntime(adapter, { definitions: [tool], invoke });
  await runtime.run(input());
  expect(invoke).toHaveBeenCalledOnce();
  expect(runtime.results.map((result) => result.errorCode)).toEqual([
    'MANAGER_INPUT_INVALID',
    'MANAGER_OUTPUT_INVALID',
  ]);
  expect(JSON.stringify(runtime.results)).not.toContain(
    'secret-should-not-leak',
  );
});
it('central authority blocks external/restricted tools even when mistakenly registered', async () => {
  const external = { ...tool, consequence: 'external_consequential' as const };
  const invoke = vi.fn();
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), final]),
    { definitions: [external], invoke },
  );
  await runtime.run(input());
  expect(invoke).not.toHaveBeenCalled();
  expect(runtime.toolTrace[0]).toMatchObject({
    approvalRequired: true,
    errorCode: 'OWNER_APPROVAL_REQUIRED',
  });
  expect(
    authorityDecision({ ...tool, consequence: 'restricted' }, 'owner'),
  ).toBe('deny');
  expect(authorityDecision(tool, 'member')).toBe('deny');
});
it('runs permitted internal reversible work without an owner interruption', async () => {
  const invoke = vi.fn().mockResolvedValue({ status: 'connected' });
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), final]),
    {
      definitions: [
        { ...tool, consequence: 'internal_reversible', readOnly: false },
      ],
      invoke,
    },
  );
  expect((await runtime.run(input())).partial).toBe(false);
  expect(invoke).toHaveBeenCalledOnce();
});
it('bounds repeated loops and total turns', async () => {
  const invoke = vi.fn().mockResolvedValue({ status: 'connected' });
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), request(), request()]),
    { definitions: [tool], invoke },
  );
  expect(await runtime.run(input(), { turns: 3 })).toMatchObject({
    partial: true,
    errorCode: 'MANAGER_TURN_LIMIT',
  });
  expect(invoke).toHaveBeenCalledOnce();
  expect(runtime.toolTrace[1].errorCode).toBe('MANAGER_REPEATED_TOOL');
});
it('stops at the tool-call cap', async () => {
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), request()]),
    { definitions: [tool], invoke: async () => ({ status: 'connected' }) },
  );
  expect(await runtime.run(input(), { tools: 1 })).toMatchObject({
    partial: true,
    errorCode: 'MANAGER_TOOL_LIMIT',
  });
});
it('preserves completed evidence and truthful partial status on deadline', async () => {
  const adapter = new FakeAdapter('fable', 'fable-19', [request()]);
  const runTurn = vi.spyOn(adapter, 'runTurn');
  runTurn
    .mockImplementationOnce(async () => request())
    .mockImplementation(() => new Promise(() => {}));
  const runtime = new ManagerRuntime(adapter, {
    definitions: [tool],
    invoke: async () => ({ status: 'connected' }),
  });
  const result = await runtime.run(input(), { deadlineMs: 30 });
  expect(result).toMatchObject({ partial: true, errorCode: 'AI_TIMEOUT' });
  expect(runtime.results[0]).toMatchObject({ ok: true });
  expect(result.answer.reply).toContain(
    '1 capability checks or preparations completed',
  );
});
it('rechecks authority before sending another model turn', async () => {
  const adapter = new FakeAdapter('fable', 'fable-19', [request(), final]);
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new AppError('AI_CONSENT_REQUIRED', 403));
  const runtime = new ManagerRuntime(adapter, {
    definitions: [tool],
    authorize,
    invoke: async () => ({ status: 'connected' }),
  });
  expect(await runtime.run(input())).toMatchObject({
    partial: true,
    errorCode: 'AI_CONSENT_REQUIRED',
  });
  expect(adapter.seen).toHaveLength(1);
});
it('bounds outputs and does not expose raw thrown secrets', async () => {
  const invoke = vi
    .fn()
    .mockRejectedValue(new Error('sk-secret private-provider-payload'));
  const runtime = new ManagerRuntime(
    new FakeAdapter('fable', 'fable-19', [request(), final]),
    { definitions: [tool], invoke },
  );
  await runtime.run(input());
  expect(JSON.stringify(runtime.toolTrace)).not.toMatch(
    /sk-secret|private-provider/,
  );
  expect(runtime.results[0].errorCode).toBe('MANAGER_TOOL_FAILED');
});
it('uses the configured Astra adapter and enforces both rollout allowlists', () => {
  vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
  vi.stubEnv('OPENAI_MODEL', 'gpt-6-astra');
  const adapter = createManagerAdapter({
    ai_primary_provider: 'openai',
    ai_allowed_providers: ['openai'],
    ai_fallback_enabled: false,
  });
  expect(adapter.model).toBe('gpt-6-astra');
  expect(adapter.provider).toBe('openai');
  vi.stubEnv('MANAGER_ENABLED', 'true');
  vi.stubEnv('MANAGER_WORKSPACE_IDS', 'workspace-a');
  vi.stubEnv('MANAGER_OWNER_IDS', 'owner-a');
  expect(managerEnabled('workspace-a', 'owner-a', 'owner')).toBe(true);
  expect(managerEnabled('workspace-b', 'owner-a', 'owner')).toBe(false);
  expect(managerEnabled('workspace-a', 'owner-b', 'owner')).toBe(false);
  expect(managerEnabled('workspace-a', 'owner-a', 'member')).toBe(false);
});
it('parses real Responses function calls and replays tool output with call_id and reasoning state', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'secret-test-key');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'reasoning', encrypted_content: 'opaque', summary: [] },
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'connections__list',
              arguments: '{}',
            },
          ],
          usage: { input_tokens: 51, output_tokens: 12, total_tokens: 63 },
        }),
        { headers: { 'x-request-id': 'req_12345678' } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(answer) }],
            },
          ],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const adapter = new ResponsesManagerAdapter('gpt-6-astra');
  expect(await adapter.runTurn(adapterInput())).toEqual({
    kind: 'tools',
    calls: [{ id: 'call_1', name: 'connections.list', arguments: {} }],
  });
  expect(
    await adapter.runTurn({
      ...adapterInput(),
      results: [
        {
          callId: 'call_1',
          name: 'connections.list',
          ok: true,
          evidence: { status: 'reconnect_required' },
        },
      ],
    }),
  ).toEqual(final);
  const payload = JSON.parse(fetch.mock.calls[1][1].body);
  expect(payload).toMatchObject({
    model: 'gpt-6-astra',
    store: false,
    parallel_tool_calls: false,
  });
  expect(payload.input).toContainEqual({
    type: 'reasoning',
    encrypted_content: 'opaque',
    summary: [],
  });
  expect(payload.input.at(-1)).toMatchObject({
    type: 'function_call_output',
    call_id: 'call_1',
  });
  expect(payload.tools[0]).toMatchObject({
    type: 'function',
    name: 'connections__list',
    strict: true,
  });
  expect(adapter.usage[0].totalTokens).toBe(63);
  expect(adapter.attempts[0].providerRequestId).toBe('req_12345678');
  expect(JSON.stringify(adapter.attempts)).not.toMatch(
    /secret-test-key|opaque|reconnect_required/,
  );
});
it('parses Anthropic tool_use and returns tool_result through the same contract', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'secret-test-key');
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'connections__list',
              input: {},
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(answer) }],
        }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  const adapter = new AnthropicManagerAdapter('test-claude');
  expect((await adapter.runTurn(adapterInput())).kind).toBe('tools');
  await adapter.runTurn({
    ...adapterInput(),
    results: [
      { callId: 'tool_1', name: 'connections.list', ok: true, evidence: {} },
    ],
  });
  expect(
    JSON.parse(fetch.mock.calls[1][1].body).messages.at(-1).content[0],
  ).toMatchObject({ type: 'tool_result', tool_use_id: 'tool_1' });
});
it.each(['AI_REFUSED', 'AI_INVALID_RESPONSE', 'AI_KEY_INVALID'])(
  'never falls back on %s',
  async (code) => {
    const first = new FakeAdapter('openai', 'gpt-6-astra', []),
      second = new FakeAdapter('fable', 'fable-19', [final]);
    vi.spyOn(first, 'runTurn').mockRejectedValue(new AppError(code, 503));
    await expect(
      new FallbackManagerAdapter([first, second]).runTurn(adapterInput()),
    ).rejects.toMatchObject({ code });
    expect(second.seen).toHaveLength(0);
  },
);
it('falls back once on availability while retaining completed tool results', async () => {
  const first = new FakeAdapter('openai', 'gpt-6-astra', []),
    second = new FakeAdapter('anthropic', 'claude-test', [final]);
  vi.spyOn(first, 'runTurn').mockRejectedValue(
    new AppError('AI_QUOTA_EXCEEDED', 503),
  );
  const adapter = new FallbackManagerAdapter([first, second]);
  const withResults = {
    ...adapterInput(),
    results: [
      {
        callId: '1',
        name: 'connections.list',
        ok: true,
        evidence: { status: 'connected' },
      },
    ],
  };
  expect(await adapter.runTurn(withResults)).toEqual(final);
  expect(adapter.provider).toBe('anthropic');
  expect(second.seen[0].results).toEqual(withResults.results);
});
