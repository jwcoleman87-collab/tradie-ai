# Token economy (non-negotiable)

Frontier models are expensive and token-heavy. Workbench must always minimise
model-token consumption without materially reducing answer quality or safety.
Token efficiency is part of the Manager architecture, and **this rule applies to
every Manager capability built from this point forward.**

Principle: spend compute deliberately. Do not spend tokens on information
Workbench can retrieve, calculate, filter, compare or summarise
deterministically. The harness owns memory and retrieval; the model consumes the
smallest sufficient working set.

Lowering `max_output_tokens` alone does not satisfy this rule. The objective is
to avoid unnecessary model input, repeated context, duplicate model calls and
verbose tool results.

## The rules

1. **Minimum context by default.** The first Manager turn carries only:
   workspace identity, a small recent-conversation window, compact business
   identity, tool names/descriptions, the authority envelope and the request.
   Never the workspace snapshot, record history, action history, files, skills
   or business profile. Everything else is fetched just in time.
2. **Context escalation.** Minimal orientation → precise record/tool lookup →
   relevant excerpt or structured evidence → larger document only if the earlier
   levels cannot answer. Never jump straight to the largest level.
3. **Compact tool results.** Tools return model-shaped projections, never raw
   database rows, provider payloads, HTML, logs or OAuth metadata. Full
   evidence stays in Workbench storage and audit.
4. **Do not re-send known context.** Within one run, unchanged tool results,
   skills and records are delivered once. Prefer references and compact
   extracts over repeating a long document.
5. **Selective skill loading.** Load only the skill the request uses. A quote
   loads finance and trade intelligence, not social, website or maintenance.
6. **Deterministic work before model work.** Arithmetic, GST, quote formulas,
   minimum charges, rounding, dates, state transitions, permission and ownership
   checks, filtering, sorting, latest-action selection, connection status,
   schema validation and field comparison are code, not model tokens. The model
   decides and intends; Workbench calculates and enforces.
7. **Avoid unnecessary router calls.** One tool-capable Manager turn, then
   deterministic or tool work, then a continuation only if new reasoning is
   genuinely required. Benchmark before changing existing routing.
8. **Explicit model-call budget** per run: turns, tool calls, input tokens,
   output tokens, total tokens and a deadline. Stop when the task is solved, not
   when the budget is exhausted.
9. **Token-aware continuation.** Before each additional model call, check
   programmatically whether it is necessary. If the action is prepared, the
   answer can be rendered from tool results, or code can finish, do not call
   the model again.
10. **Concise owner-facing responses:** result, recommendation, required
    decision. Evidence is on demand, not a dump. No capability essays.
11. **Documents and records** go through search → relevant section → compact
    extract → model. Cache derived summaries where provenance permits.
12. **Conversation history** is a small recent-turn window plus durable
    structured state, not a replay of the transcript.
13. **Tool descriptions** contain only what the Manager needs to select and
    safely call the capability. Security and business enforcement live in
    server code, not prompt prose.
14. **Model selection** stays a configuration concern: cheap models for trivial
    classification, the Manager model for coordination, a stronger model only for
    exceptional cases. Preserve the adapter boundary; do not build complexity
    for theoretical savings today.
15. **Cache safe results** (compiled skills, rule projections, connector
    metadata, document extraction). Never serve stale live state (connections,
    action state, calendar availability) as current.
16. **Observability.** Every run records provider, model, input/output/total
    tokens, cached tokens reused, model calls, tool calls, context size supplied
    and outcome, enough to answer "why did this simple task cost 12,000
    tokens?" without storing secrets or private payloads.
17. **Token regression tests** protect against context bloat (see below).

## How the current runtime implements it

| Rule  | Where                                           | Mechanism                                                                                                                                                                                                                                                                                                               |
| ----- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 12 | `lib/server/manager/chat.ts`                    | `boundedHistory` keeps at most 8 messages / 12,000 chars (latest message up to 6,000, older up to 2,000 each). First-turn context is workspace name, time zone, role, time and the authority envelope only. The Manager path in `lib/server/api.ts` skips the legacy routing call and the conversation action snapshot. |
| 2, 3  | `lib/server/manager/tools.ts`                   | Every tool returns a strict Zod projection inside an evidence envelope, capped at 24,000 chars by the runtime. Lists return at most 8–12 rows with a `totalMatchingCount`; record bodies are cut to 1,800 chars; action payloads to 2,500; connections expose identity and health, never tokens.                        |
| 4     | `lib/server/manager/adapters.ts`                | Each adapter tracks a `delivered` index and appends only new tool results to the provider transcript. The runtime rejects an identical repeated tool request (`MANAGER_REPEATED_TOOL`).                                                                                                                                 |
| 5     | `skills.read`, `quotes.prepare`                 | Skills load only when asked for by name or implied by a prepared proposal's agent. Trade intelligence loads only for quotes or an explicit read.                                                                                                                                                                        |
| 6     | `lib/server/manager/quote.ts`, `calculate`      | Quote totals, minimum charge, travel and GST are code. Authority, membership, consent and schema checks run in the runtime and registry.                                                                                                                                                                                |
| 8, 9  | `lib/server/manager/runtime.ts`                 | `MANAGER_LIMITS`: 6 turns, 12 tool calls, 85 s, 3,500 output tokens per call, 60,000 input / 80,000 total model tokens per run. Usage is re-summed after every model call and the next call is refused with `MANAGER_TOKEN_LIMIT` once the budget is spent.                                                             |
| 13    | `lib/server/manager/tools.ts`                   | Tool descriptions are one to three sentences; the regression test caps the total.                                                                                                                                                                                                                                       |
| 14    | `lib/server/manager/config.ts`                  | `MANAGER_MODEL` overrides the primary model without business-code changes; the adapter boundary is provider-neutral.                                                                                                                                                                                                    |
| 15    | `lib/server/manager/adapters.ts`                | Anthropic requests mark the system prompt and tool list as an ephemeral cache prefix. Cached input tokens are recorded from both providers (`cachedInputTokens`).                                                                                                                                                       |
| 16    | `runtime.economy` → `agent_runs.provider_trace` | The terminal Manager metadata entry carries `economy`: model calls, tool calls, input/output/total/cached tokens, first-turn context chars, evidence chars per tool and the stop reason (`final`, `budget`, `error`).                                                                                                   |
| 17    | `tests/manager-token-economy.test.ts`           | Scripted-adapter regressions for the three representative tasks plus budget stop, history window, cache marking and cached-token accounting.                                                                                                                                                                            |

## Regression tasks

| Task                                | Must load                                                | Must not load                                        |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| "Which Facebook page is connected?" | connection projection                                    | quote rules, action history, any skill, records      |
| "Raise a GreenVac quote."           | finance skill, trade intelligence                        | Facebook history, website/social skills, connections |
| "Why did this action fail?"         | at most 8 compact action rows, one action, its diagnosis | records, the whole workspace, any skill              |

## Building a new Manager capability

- Return a projection the model needs, validated by a strict schema with
  explicit maximum sizes. Keep full evidence server-side.
- Bound lists and bodies. Disclose truncation and coverage in the result.
- Do not load skills, packs or profiles inside a tool unless that tool's task
  needs them, and record what was loaded in `versions`/`selected`.
- Keep the description short. Enforcement belongs in the executor.
- Add a row to the regression test if the capability introduces a new loading
  path, and check `economy.evidenceChars` for it in a live run.
