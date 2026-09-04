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
| Excessive routing/context cost | Router context is limited to the last six messages and 2,000 characters per message, with a separate 2,048-token output budget. Original GPT-5 models use minimal reasoning for routing. Independent database reads and attachments are bounded and concurrent. |
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
No prompts, files, customer content, credentials or raw provider errors are logged.
Safe diagnostics may include numeric output/reasoning token counts and an
allowlisted incomplete-response reason.

## Deployment sequence

The current native application target is the existing Vercel project at
`https://tradie-ai-efuf.vercel.app`. This current alias was verified on 5 September;
the historical `tradie-ai-nine` alias returns `DEPLOYMENT_NOT_FOUND`.
`.openai/hosting.json` identifies the older private Sites deployment. After
explicit owner approval, that separate source repository was deployed with a
minimal retirement Worker; its obsolete application must not be redeployed.

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

Final local validation: **277 tests passed across 23 suites**, lint passed,
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

Authenticated Supabase administration was subsequently available in Chrome. The
verified project is **Tradie Ai**, `gjrhukwqagaawdklnvxd`, in organization
`fxmmlbekdpofrrkyvmqp`; the current Vercel public configuration points to this
same project. Preflight found all expected baseline migrations except
`202609020008_continuous_magic_onboarding.sql`: the onboarding constraint
still limited prompts to five. Both this missing migration and the new lifecycle
migration have now been applied. All five checked baseline function definitions and server-only
grants exactly matched the audited baseline. There were no working Chat runs or
live OAuth states/candidates; aggregate counts were 90 messages, 22 proposals,
three workspaces and two saved credentials.

Supabase's Free plan provides no database backups. A reviewed transaction wrapper
was tested against the missing-008 baseline: both success and forced failure
behaved correctly, including rollback of both migrations and ledger entries. It
also preserves the replaced function definitions/grants and constraints in a
postgres-only schema, copying no customer content or credentials. This schema
restore record is a rollback aid, not a disaster-recovery backup.

The owner explicitly approved proceeding without a full backup. After adding
explicit RLS and privilege revocation to the transaction's temporary staging
table, both success and forced-rollback tests passed again. The reviewed wrapper
then executed successfully through authenticated Supabase administration.
Independent postflight reads confirm both migration ledger entries, all 13
affected functions restricted to the server role, the onboarding limit of 200,
and unchanged aggregate counts of 90 messages, 22 proposals, three workspaces
and two credentials. The private restore record contains five function
definitions, three constraints and aggregate counts only.

No production secrets were downloaded. The remote setup CLI check was replaced
by direct metadata, function-definition and permission checks through
authenticated administration.

The initial repair build `dpl_121HmyhF156ALXmNo6GN5Gnz2NuB` was Ready at
`https://tradie-o184xxnqt-jwcoleman87-collabs-projects.vercel.app`. It was staged
with production configuration using `--skip-domain`, then promoted after
database verification. It was built from commit
`1825c388f3dd297c7305f34558444fee52636bc4`. Its actual API function timeout is
150 seconds, Node.js 24 runs in `iad1`, and Fluid Compute is enabled.
Post-promotion checks passed: the homepage returns 200, health and public
configuration report ready against the correct Supabase project, unauthenticated
Chat/status requests return 401, and an untrusted Origin returns 403. The bounded
deployment-log check contained only these expected authentication probes.
The current Google OAuth client already lists both required `efuf` Calendar/Ads
callbacks; no provider configuration was changed.

### Live Chat verification and routing correction

The owner signed into the current app in Chrome. The selected workspace was
**My business · Business** with existing OpenAI processing consent. A separate
verification conversation preserved the earlier conversation. Calendar,
Facebook Pages and Google Ads all showed **not connected** in this workspace;
there was no connected resource on which to run Check connection.

The first caption test exposed a routing failure: OpenAI `gpt-5-mini` returned
HTTP 200 with `AI_INCOMPLETE` after 9,631 ms. The saved message and editable next
draft remained intact. The router's 768-token allowance included hidden reasoning
and could end before any structured JSON appeared. The repair now uses minimal
reasoning for original GPT-5/mini/nano aliases and dated snapshots, with a
2,048-token total routing allowance. Other model families and final generation
retain their existing request parameters. Model selection, consent and deadlines
are unchanged. Safe diagnostics identify token exhaustion without recording
partial model output. See [OpenAI's reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

The follow-up fix passed 277 tests, lint, typecheck and build, plus an independent
review. Canonical production now resolves to **`dpl_5eFzwN4RQCV2LtM4hYMjSHoixNfS`**,
source **`a775cb6cceef548454d9f0a1c7049bea5efd67a5`**, at
`https://tradie-quck3d8uv-jwcoleman87-collabs-projects.vercel.app`. The verified API
runtime remains Node.js 24 in `iad1` with a 150-second timeout.

Both repeated live checks succeeded. The caption appeared directly and the
Calendar reply correctly stated that Calendar was disconnected and availability
had not been checked. Reloading while the accepted Calendar request was working
recovered its persisted reply without a duplicate user message. No test proposal
or external action was created or accepted.

| Server duration | Caption | Disconnected Calendar |
| --- | ---: | ---: |
| Authentication | 967 ms | 288 ms |
| Durable acceptance | 3,717 ms | 2,495 ms |
| Submission to saved acknowledgement | 4,684 ms | 2,783 ms |
| Database context | 877 ms | 865 ms |
| Routing | 2,291 ms | 1,443 ms |
| Records | 291 ms | 320 ms |
| Attachments / skills | 0 / 4 ms | 0 / 2 ms |
| Final generation | 6,777 ms | 7,395 ms |
| Persistence | 2,041 ms | 654 ms |
| Total request | 16,965 ms | 13,462 ms |

These are production server timings, not browser paint measurements. Neither
request performed Calendar or web research work. The bounded current-deployment
log check returned two timing records and zero Chat failures. The corresponding
runs are `1993635f-5ba0-4772-bcf0-af84221bba94` and
`74f796d3-ac67-4139-9405-9d748dd773bb`, completed around 23:10 and 23:11 UTC on
4 September (5 September in Sydney). Connected-provider health, fresh Calendar
availability and real OAuth resource selection remain unverified in production
because this selected workspace has no connections.

### Legacy deployment retirement

The old `tradie-ai-business-team.j-w-coleman87.chatgpt.site` deployment still
served the historical application against the same business history. Its direct
credential writes could bypass the new generation fence. After explicit owner
approval, the existing private Site was replaced with a standalone Worker that
imports no old application code and has no outbound requests or database access.

Document GET/HEAD requests redirect with HTTP 303 to the fixed canonical
workspace. Paths, queries and OAuth fragments are discarded. API requests,
callbacks and all write methods return HTTP 410; nothing is forwarded. Three
retirement tests passed, and the validated archive contained only the Worker and
hosting metadata. Source commit `b01c04c217a445f1025da9fc572174806279d13a` was
pushed to the existing Sites repository and published as version 18. Deployment
`appgdep_6a9b503959888191aacad5739f03ac74` succeeded at
2026-09-04 23:12:18 UTC. Owner-only access was preserved and independently checked.

Authenticated Chrome verified that the old bookmark opens the current workspace.
Owner-authenticated HTTP probes confirmed the fixed 303 destination and HTTP 410
for the old health endpoint and an inert OAuth callback, with no-store and
no-referrer headers. Historical source remains in Git, outside the deployed
bundle. Do not roll back either host to the obsolete credential-write paths.

At 2026-09-04 23:15:39 UTC, more than 150 seconds after the retirement completed,
an independent aggregate-only database check found zero working Chat runs, zero
live OAuth states and zero live candidates. Both successful verification runs
were completed. Messages increased from 90 to 95 by the expected three test
submissions and two replies; proposals remained 22 and credentials remained two.
No blanket generation update or deletion of expired authorization rows was needed.

Provider references: [Meta's maintained Pages task example](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api?entity=request-23987686-0b79260c-96bd-49de-875b-6076213785fc),
[Google Ads common errors](https://developers.google.com/google-ads/api/docs/common-errors),
[Google Ads structured errors](https://developers.google.com/google-ads/api/docs/get-started/handle-errors).
Meta's Graph error guide returned HTTP 429 during source verification.
