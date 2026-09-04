# Connector and Chat audit repair

Prepared 5 September 2026 against audit baseline
`3ebc4c3c0fd951463c038ff88311fc8bad6ed189`.

## Repairs

| Audit finding | Result |
| --- | --- |
| Modern Facebook Pages rejected | Explicit publishing-capable legacy and `PROFILE_PLUS_*` tasks accepted. Required scopes and Page token checks retained. |
| Temporary Facebook errors disable connections | Bounded provider error parsing separates throttling/transient failures from confirmed authorization or publishing-permission failure. Temporary failures preserve status and credentials. |
| Interrupted Chat stays working on replay | The same saved request is atomically expired after its lease. Status reads expire it too; replay never duplicates the user's message. Late workers cannot commit after lease expiry. |
| One Ads root prevents all choices | Four concurrent discovery workers, at most twenty roots, isolate account-specific access/disabled errors; successful choices carry an incomplete-discovery notice. Global token/configuration failures still fail visibly. |
| Ads permission errors reported as outages | Structured Ads codes distinguish account access, account state, OAuth authorization, developer-token/configuration, quota and temporary failures. Recovery copy matches the cause. |
| Calendar work before every Chat turn | The structured router decides whether availability is needed before Calendar is fetched. Calendar reads use the same pinned connection; unrelated requests make no Calendar calls. |
| Excessive routing/context cost | Router context is limited to the last six messages and 2,000 characters per message, with a separate 768-token output budget. Independent database reads and attachments are bounded and concurrent. |
| No acknowledgement/progress until completion | An optimistic message appears immediately; a durable NDJSON acceptance receipt clears the composer. Stage updates continue during processing; the final persisted reply renders directly. Other panels refresh in the background. |
| No coherent total deadline | 110 seconds for work plus persistence within a 120-second total budget, a 150-second database lease and a 150-second route maximum. Stage deadlines and cancellation apply across fallback. All bounded attempts are retained. |
| Reconnected actions cannot be resolved | Original approvals, connection IDs and payloads remain immutable. Replacement creates a new pending proposal for a currently verified connection and requires fresh approval. Obsolete proposals can be cancelled with history retained. |
| Calendar disconnect paths disagree | Both paths use a shared transactional disconnect. Durable provider generations invalidate pending states, candidates and already-consumed callbacks at commit. |

Additional related defects found during implementation were repaired:

- Google refresh-token HTTP 400 is no longer automatically treated as revocation.
  Only `invalid_grant` requests reconnection; configuration and temporary failures
  retain the saved credentials. Ads and Calendar share the classification.
- Read-only health checks can retry a pinned connection previously marked for
  reconnection. Reading a Facebook Page name cannot clear a confirmed missing
  publishing permission; that requires the OAuth permission checks again.
- Calendar replacement examines all earlier execution attempts, so an uncertain
  write cannot be hidden by a later pre-send failure. Unknown Facebook publishing
  outcomes remain blocked as well. Past Calendar start times require a new booking.
- If the database completion outcome is uncertain, Chat returns a pollable saved
  receipt instead of claiming the reply failed. A confirmed completion wins the
  cancellation race.

## Chat protocol and timings

`POST /api/chat` supports `Accept: application/x-ndjson`. Events are a durable
`accepted` receipt, `progress` stages, then a `completed` or `failed` result (an
uncertain database outcome remains `working`). JSON callers remain supported.
No partially generated proposal can become an executable action: complete schema
validation and the atomic proposal transaction precede the terminal receipt.
Reply text is delivered after structured validation; this change streams stages,
not unvalidated model tokens.

`GET /api/chat/status?workspaceId=...&requestId=...` authenticates membership and
returns the persisted outcome and assistant message. The client follows accepted
replays, dropped streams and working runs loaded after a page reload. Status
requests have a ten-second timeout and retry with capped backoff. An unsaved or
uncertain submission retains the draft and its request UUID. Saved messages free
the composer for drafting while a further Send remains blocked until completion.

The selected provider and workspace consent rules are unchanged. Stage budgets
are routing 20 seconds, Calendar 12 seconds, research 25 seconds and response
45 seconds, capped by the remaining total work budget. A fallback shares its
stage deadline. Access tokens are cached in server memory only, keyed by workspace,
connection and encrypted credential, with expiry margin, bounded cache size and
invalidation on reconnect/disconnect. Every reuse first checks the durable
connection; availability itself is read fresh.

Server `chat.timing` logs contain stage durations and safe request/run identifiers.
Provider traces retain stage, provider/model, duration, status and safe request
references. Browser Performance entries `workbench.chat.acknowledgement` and
`workbench.chat.reply` measure submission-to-receipt and submission-to-result for
the active response. Polling recovery renders its persisted result separately.
No prompts, files, customer content, tokens or raw provider errors are logged.

## Deployment sequence

The current native application target is the existing Vercel project at
`https://tradie-ai-nine.vercel.app`. `.openai/hosting.json` identifies the older
private Sites deployment; do not migrate hosting or publish that older build as
part of this repair.

1. Verify the intended Workbench Supabase project and take/confirm a restorable
   backup. Keep migrations away from other product databases.
2. Pause new connection changes for the rollout and drain old server requests.
   The prior Calendar callback wrote credentials directly, so the full generation
   fence requires that old code no longer execute. Invalidate old pending OAuth
   attempts at this cutover; owners can restart them afterward.
3. Apply all prior migrations and then
   `supabase/migrations/202609050009_chat_and_connection_lifecycle.sql`; record it
   in the migration ledger. The migration is additive except for replacing
   functions and widening existing checks; it preserves customer messages,
   credentials, proposals and approval evidence.
4. Deploy this exact validated source to the existing Vercel project, retaining
   its encrypted runtime configuration, consent and publishing settings. Verify
   the host honors the 150-second route allowance.
5. Run `npm run setup:check -- --remote` with the approved project configuration.
   The readiness check now includes lease, generation and replacement columns.
   Verify `read_chat_receipt`, disconnect and replacement RPCs are server-only.
6. From the authenticated Workbench UI, use **Check connection** for Calendar,
   Facebook and any connected Ads account. Verify the selected resource and
   actionable status. Do not initiate consent, post, event or ad operations.
7. In an owner-selected test conversation with existing AI consent, measure an
   unrelated caption/draft request and an availability request. Verify fast saved
   acknowledgement, no Calendar call for the former, fresh Calendar context for
   the latter, provider-stage durations and final reply. No proposed external
   action is accepted during timing checks. Test drop/reload recovery and inspect
   the same request ID, with no duplicate message or proposal.

Do not roll back to the old OAuth write path after enabling the generation fence.
A rollback must preserve these database and connection protections.

## Verification and limits

Final local validation: **266 tests passed across 23 suites**, lint passed,
typecheck passed, the native Next.js production build passed, and the npm
dependency audit reported **zero vulnerabilities**. `git diff --check` passed.
The Worker test initially hit an esbuild Windows sandbox directory permission;
it and the complete final suite passed outside that sandbox. The first npm
audit was blocked by network access; the permitted network run passed.

Automated tests cover real migration execution in isolated PGlite and mocked
provider/AI calls, including the audit reproductions and additional concurrency
and failure cases. The actual Worker-runtime transport check also runs in
Miniflare. The local browser smoke harness uses synthetic API responses to check
the actual Chat hook's acceptance, next-draft preservation, direct final reply,
drop/status recovery and stale-run expiry. It is not an authenticated production
end-to-end test.

The source is saved in [draft PR #3](https://github.com/jwcoleman87-collab/tradie-ai/pull/3).
GitHub Linux CI passed, and the automatic Vercel preview deployment passed.
GitHub and Vercel CLI authentication work outside the Windows sandbox. The
existing Vercel project identity was verified and linked locally; its production
configuration names were inspected without exposing secret values.

Production rollout remains pending Supabase administration access: its CLI
returns Unauthorized and its browser session requires sign-in. Automatic approval
review rejected pulling production environment secrets into a local file, so that
readiness check did not run and no secrets were downloaded. Use authenticated
Supabase administration to verify backup/schema and apply the migration, then
deploy the verified source through the existing Vercel session. No production
migration, production deployment or real provider action has been performed.
Production connection results and timing attribution remain unverified.

Provider references: [Meta's maintained Pages task example](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api?entity=request-23987686-0b79260c-96bd-49de-875b-6076213785fc),
[Google Ads common errors](https://developers.google.com/google-ads/api/docs/common-errors),
[Google Ads structured errors](https://developers.google.com/google-ads/api/docs/get-started/handle-errors).
Meta's Graph error guide returned HTTP 429 during source verification.
