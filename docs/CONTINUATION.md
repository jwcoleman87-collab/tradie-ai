# Workbench — continuation checkpoint for Claude or another engineer

> **Connector and Chat repair, 5 September 2026:** See
> [CONNECTOR-CHAT-REPAIR.md](CONNECTOR-CHAT-REPAIR.md) for the repaired source,
> lease/deadline policy, required migration, verification and pending rollout.
> Current production address: `https://tradie-ai-efuf.vercel.app`. Both required
> migrations are applied and the repaired build is live. Deployment/schema
> checks passed; signed-in provider and Chat timing checks remain pending.
> Older deployment statements below are historical, not verification of this repair.

> **Current next-build handover (2 September 2026):** Read
> [`HANDOVER-LANDING-ONBOARDING.md`](./HANDOVER-LANDING-ONBOARDING.md) before
> starting new work. It contains James's locked-aesthetic direction and the
> authoritative landing page/intelligent onboarding assignment. Where dated
> operational statements below conflict with later provider receipts or that
> handover, treat the newer evidence as authoritative.

Updated 2 September 2026 (Australia/Sydney). Read this before making changes.
Do not restart setup. See the current repair note and release checkpoint below.

## Current release: connector OAuth returns and Facebook publishing lock

Calendar, Facebook and Google Ads OAuth callbacks now return to `/workspace`
instead of the public landing page. Both successful and cancelled returns reopen
Connections; Facebook and Ads discovery returns preserve the encrypted candidate
ID so the owner can choose the exact Page or advertiser account. Eight direct
regression tests cover all three start URLs, Calendar success/cancellation,
Facebook and Ads cancellation, and the Ads resource-picker return.

Source commit `b4b4fd2` was pushed and deployed to Vercel production as
`dpl_7abscesSp8smW9PqhMmu2eBWSmhD`. The deployment is Ready and the stable
`https://tradie-ai-nine.vercel.app` alias points to it. The production Sensitive
environment variable `FACEBOOK_PUBLISHING_ENABLED` is explicitly `false`.
Authenticated browser verification shows Calendar connected, Facebook connected
to Werka Mechanical Hitch with publishing disabled, and Google Ads available to
connect but not connected. Live Calendar and Ads callback-state URLs reopen
Connections. No OAuth flow, provider disconnect, post, event or ad action was
initiated during verification.

Verification passes: typecheck, lint, all 151 tests in 15 suites, production
build, dependency audit with zero vulnerabilities, remote setup readiness and
`git diff --check`. The landing, sign-in and workspace routes return HTTP 200;
the post-deployment error-log window was empty. Google Ads API Center now shows
Basic Access granted. Google Auth remains External / Testing with incomplete
branding, and the Meta app remains in Development; those are still external
customer blockers.

## Current release: public landing and intelligent onboarding

The existing Next.js/Vercel application has separate `/`, `/sign-in`,
`/onboarding` and `/workspace` routes. The public route is deliberately a
single-screen branded entry point: one promise, one primary **Start chatting**
action and a quiet existing-owner sign-in link. It does not expose the crew,
feature catalogue or product internals. Sign-up is one small account step before
Chat takes over as the guide. Existing workspace visuals remain intact behind
`/workspace`; signed-out workspace visits go to the dedicated sign-in route.

Onboarding is a focused, single-column Chat conversation with at most five
adaptive prompts, followed by a **What Chat found** review. Secondary setup
details are collapsed so the first screen contains only the guide, current
question and answer composer. Facts retain their source and confidence,
corrections remain owner-supplied, and confirmation is required before entering
the workspace. Website, public-profile and registry research is an explicit
unavailable adapter: the UI and API state that no external research ran rather
than presenting guesses as discoveries. Onboarding performs no external actions.

Migration `202609020007_intelligent_onboarding.sql` is applied and recorded in
the hosted Supabase migration ledger. It adds tenant-scoped business profiles,
profile facts and onboarding sessions. All three tables have RLS; authenticated
browsers can read only their workspace and cannot write directly. Server routes
authenticate the JWT, verify membership and owner role, validate every payload,
and write through the server-only client. The hosted authentication redirect
allow-list contains the exact production and localhost onboarding/recovery URLs.
`npm run setup:check -- --remote` reports intelligent onboarding ready.

Verification passes: typecheck, lint, all 143 tests in 14
suites, production build, dependency audit with zero high-severity findings,
and `git diff --check`. Local browser QA passed on desktop and at 390px with no
horizontal overflow or browser errors. Signed-out `/onboarding` and `/workspace`
redirect correctly.

Source commit `97f6236` was pushed and deployed to Vercel production as
`dpl_9P8aBPBQ3mL1ZoXGzz4JZ7wmuDtK`; the deployment reached Ready and the stable
`https://tradie-ai-nine.vercel.app` alias points to it. Production browser checks
passed for the one-screen landing, focused sign-up path, both signed-out redirects,
the existing authenticated workspace and the read-only first onboarding screen.
The initial Chat screen fits without document scroll in the authenticated browser.
No onboarding response or external action was submitted. Its post-deployment log
window contained no application errors or HTTP 500 responses.

## Current release: Facebook photo publishing and password recovery

Production is live at `https://tradie-ai-nine.vercel.app`. The Social agent now
prepares a distinct `facebook.publish` proposal for one ready private JPEG/PNG
under 4 MB after the owner confirms image rights. The approval card shows the
exact caption, selected filename and a short-lived private preview. Accepting a
plain draft still saves privately; only the separate **Publish to Facebook**
button executes. The server revalidates workspace/conversation ownership, MIME
magic bytes, size and SHA-256 immediately before a multipart Meta `/photos`
request. A database guard binds the immutable action to that same upload.

The migration `202609010005_facebook_photo_publish.sql` was applied successfully.
The existing Facebook connection is healthy. No real post was sent during this
repair or verification. Provider requests are mocked in tests and live browser
checks stop before the Publish button.

Sign-in now includes **Forgot password?**. Reset requests use Supabase email
recovery with a non-enumerating confirmation, recovery links show matching new-
password fields, and success signs the recovery session out before returning to
sign-in. Supabase Site URL and the redirect allow-list now include the Vercel
origin; the old prototype origin remains allowed. Typecheck, lint, production
build and all 131 tests in 12 suites pass.

## Previous repair: Claude Chrome audit feedback

The hosted AI failure was reproduced in workerd: `redirect: 'error'` is rejected
before either provider is contacted. Both adapters and related Facebook/Ads
helpers now use manual redirects and reject non-2xx responses. Node-only API
success did not cover this constraint. OpenAI passed real routing/generation
inside workerd after the fix; the latest Claude call reports `AI_QUOTA_EXCEEDED`
(HTTP 400). Its API credits/usage limit needs owner attention. Do not infer
current availability from earlier successful tests.

Saved messages now clear the composer even when generation fails; uncertain
drafts retain their request UUID, and double sends are locked. Paused processing
has an inline explanation/settings shortcut. Failures append `chat.failed`;
success already used atomic `chat.completed`. Audit shows ten runs, fixed
explanations, provider/model, HTTP status, elapsed time and safe request IDs.
Raw provider errors/customer content are not logged. CHAT-TROUBLESHOOTING.md
records the separate failure-row/audit-write limitation and testing boundaries.
129 tests in 12 suites, typecheck, lint and production build pass.

Calendar is already connected: a metadata-only read confirmed the connected
record created `2026-08-31T12:10:27.329955+00:00`. Do not repeat setup based on
older sections. No token was read and no approved live event test was performed.

The user supplied headline findings, not all sixteen audit items. The report's
suggestion to delete its test messages is not owner permission; they remain.
No consent, schema, keys, Google settings, publishing flags, ads or events were
changed in this repair. The exact validated repair is deployed as version 7.
Clean Linux CI also passed installation, typecheck, lint, all 129 tests, build
and dependency audit: https://github.com/jwcoleman87-collab/tradie-ai/actions/runs/33393347168.
Post-deployment HTTP checks passed Auth, two-workspace isolation, direct-write
denial, private Storage, public configuration safety and readiness. All synthetic
fixtures were removed; customer messages were untouched. Full interactive hosted
chat/approval acceptance remains distinct from these checks and the real OpenAI
test inside local workerd. No claim of live Calendar execution is made.

## Workbench brand update

On 2 September 2026 the owner approved the Workbench identity. The primary
source is `docs/brand/workbench-styleboard.png`; implementation tokens and logo
rules are in `docs/brand/README.md`. The product language is **Crew → Chat
→ Workspace**, using the joined owner-and-crew mark, Workbench yellow, workshop
ink/navy, Work Sans headings and Inter body copy. Do not restore the former blue
tile logo or purple/lilac Tradie AI theme. Preserve legacy `tradie-ai` cloud,
database, OAuth and repository identifiers until each can be migrated safely.

## User intent

Continue the existing three-panel Workbench product without rewriting its working
architecture. Apply the approved Workbench brand system consistently.
Complete real connections for OpenAI and Claude, Google Calendar, Facebook
socials and Google Ads. OpenAI and Claude should back each other up if API quota
or availability fails. Preserve private customer workspaces, managed Markdown
crew specialists, Proposed Actions, owner Accept/Deny, audit and privacy-safe Ask James.
Do not pause for minor choices. Do not invent credentials, claim fake connections,
publish posts or spend money without the appropriate exact approval.

## What exists

- One React/Vinext + Cloudflare Worker-compatible app. Same-origin API handler:
  `app/api/[...path]/route.ts` → `lib/server/api.ts`.
- Supabase Auth, Postgres, private Storage, RLS and server-only write RPCs.
  Five managed Markdown skills under `skills/`; Social/Marketing now 1.1.0,
  others 1.0.0. Runs record exact versions/hashes.
- Central conversation routing and structured generation, persistent history,
  selected uploads, private records, owner-approved execution, audit and cases.
- OpenAI Responses + Claude Messages adapters. Preferred provider, explicit
  allowed-provider list, optional backup, no refusal circumvention, at most one
  switch per message. Existing OpenAI consent does not authorise Anthropic.
- Usage and safe provider traces on successful/failed runs. Audit panel shows
  ten recent traces. No balances or exact cost calculation is claimed.
- Google Calendar OAuth/primary-calendar event creation with deterministic IDs.
- Separate Calendar/Facebook/Ads connections, encrypted expiring resource picker,
  owner-only connect/disconnect and exact connection identity binding.
- Facebook immediate text/link posting after explicit Publish approval; write-
  ahead receipt blocks duplicate POSTs after uncertain results or crashes.
- Google Ads account discovery and read-only last-30-days campaign reports.
- Connections panel includes AI consent/settings, provider setup states,
  account/Page selection and Ads reporting; original colours/layout preserved.

## Activation completed

The owner's signed-in Chrome dashboard became available. Migrations 003 and
004 were applied together in a transaction and recorded with their SQL in the
Supabase migration ledger. All four migrations are live. Preflight and postflight
both showed one existing user and workspace; these were preserved. All 21 public
application tables have RLS, new private tables have no browser grants, and the
privileged RPCs are not executable by anon/authenticated. Existing workspace
consent remained OpenAI-only. All four remote setup probes now report ready.

The owner supplied both API keys. They were configured as hosted secrets and
in ignored local `.env`, never committed or bundled. Both keys authenticated and
performed real routing; generation exposed Zod 4's unsupported `oneOf` and URL
format. `lib/server/model-schema.ts` converts transport unions to `anyOf` and
unsupported formats to descriptions. Original Zod validation remains mandatory.
Both providers then completed routing plus private draft generation with only
synthetic input: OpenAI `gpt-5-mini`, Claude `claude-haiku-4-5-20251001`.
No database records or external actions were created by these model tests.

Post-deployment HTTP tests passed password sign-in, authenticated state,
two-workspace isolation, direct browser-write denial, private Storage and both
provider-readiness flags. The two synthetic users/workspaces/file were removed
successfully; the owner's existing records were not changed. No audit/RLS
protections were disabled for cleanup.

Saved versions 4/5 predate this live-discovered fix. Do not redeploy them as a
working AI release. The current deployed runtime is version 6, listed below.

## Known identities (not secrets)

- GitHub: https://github.com/jwcoleman87-collab/tradie-ai (private).
- Supabase: `gjrhukwqagaawdklnvxd`, Tradie Ai, Singapore.
- Site: https://tradie-ai-business-team.j-w-coleman87.chatgpt.site
- Sites project: `appgprj_6a952d52f72c81919fa229c3f5f93e8c`.
- LIVE runtime source: `b0c19dee017a74a852594e070d151a75a9fd1260`.
- LIVE saved version: 7; hosting environment revision: 4.
- LIVE version ID: `appgprj_6a952d52f72c81919fa229c3f5f93e8c~appgver_3949588450cc8191b176e66b84ba0d12`.
- LIVE deployment: `appgdep_6a9577a7fc8c81918706510a103b1bec`, succeeded.
- Later documentation-only commits may follow the runtime commit.
- Access last verified owner-only, custom, one user, zero groups/visitors.
- `.openai/hosting.json` is authoritative. Do not create a duplicate site.

## Google Calendar setup and remaining connections

After being asked explicitly, the owner said "please continue" and authorised
the separate Google project. **Tradie AI (`tradie-ai-507211`) is now created**
under the owner's Google account, with No organization. No billing was enabled
and the existing Gemini/My First Project resources were not changed. Do not
create another project; reuse this exact ID.

The owner then answered **yes** to accepting Google's API terms, Calendar terms
and User Data Policy and completing testing-only setup. These agreements were
accepted, Calendar API was enabled, and OAuth configuration was saved as Tradie
AI, External / Testing, with the owner's support/contact email. The sole saved
test user is `j.w.coleman87@gmail.com` (verified after a page reload).

**Tradie AI Calendar — Web** is the existing Web Application OAuth client.
Both exact callbacks in CONNECTIONS.md were registered; JavaScript origins are
empty. Only `https://www.googleapis.com/auth/calendar.events` is declared.
Google automatically registered `j-w-coleman87.chatgpt.site` as the authorized
domain; the deployed app's home-page link is saved. Client ID and secret were
captured from Google's one-time creation dialog without printing them and saved
in ignored `.env` plus Sites server settings. Do not recreate or request them.
The stable token-encryption secret and all other runtime settings were preserved.

Saved version 6 was redeployed with environment revision 4. Post-deployment checks
passed `googleReady: true`, both AI flags, no Google/backend secret in public
configuration, password sign-in, two-workspace isolation, direct-write denial
and private Storage. All temporary users/workspaces/file were removed successfully.
That configuration-only release changed no runtime source. The subsequent chat
repair above is now deployed with the same environment revision and 129 tests.

**The account is now connected.** A metadata-only read confirmed the connected
Calendar record at the timestamp above; no token was inspected. Do not reconnect
unnecessarily. Token refresh and real event creation remain unverified. An exact
test event requires separate appropriate owner approval.

Google's Audience page still shows incomplete branding and disables Publish app.
Public privacy/terms links and production branding/domain verification are not
complete; do not invent policies or publish/broaden access to bypass this. The
scope/client/test-user configuration and account connection are saved; live event
execution is the next verification boundary. See Google's production requirements
linked in CONNECTIONS.

- Google setup: https://console.cloud.google.com/auth/overview?project=tradie-ai-507211
- Google client credentials and an account connection are present, not missing.
- Meta app `Tradie Ai` is created under GreenVac and remains unpublished. Its
  app ID, secret, Business Login configuration and supported Graph API `v26.0`
  are installed in ignored local and hosted settings. The exact OAuth callback
  is saved. `pages_show_list`, `pages_read_engagement` and
  `pages_manage_posts` are ready for testing and selected in the login
  configuration. `FACEBOOK_PUBLISHING_ENABLED=false` is enforced in production.
  The Sandbox workspace is connected to Werka Mechanical Hitch; do not reconnect
  it unnecessarily or publish a test post. GreenVac business verification/app
  review remain external-customer blockers.
- Google Ads production configuration and Basic Access are installed. Google Ads
  API Center showed Basic Access granted on 2026-09-02 for Cloud project
  `834544866435` and manager account `644-561-3241`. GreenVac advertiser
  `577-483-5580` remains unconnected and must eventually be attached to the
  GreenVac Tradie AI workspace, not Sandbox/Test 01 James.

OpenAI, Anthropic and Google client keys, Supabase URL/publishable/server keys and encryption secret already exist in
ignored local `.env` and hosted settings. Do not print, overwrite, commit or
request them again. The Supabase server key and both AI keys supplied in chat
are exposed: coordinate rotation before customer data, update both environments, redeploy
and verify. Preserve the encryption key unless deliberately migrating tokens.
ChatGPT/Codex/Claude subscriptions do not supply backend API credits.

## Resume in this order

1. Inspect working-tree changes, this file, README, CONNECTIONS and VERIFICATION.
   Preserve any newer user changes. No unrelated repositories/databases are in scope.
2. Inspect migration history if changing the schema; 001–007 are already applied.
   Never reapply/reset production or disable append-only/RLS protections.
3. Run `npm run setup:check -- --remote`; require all four schema probes `ready`.
4. For code changes, run typecheck, lint, tests, production build and dependency audit.
   Use the existing lockfile/runtime; no dependency replacement is necessary.
5. Preserve the existing Google account connection and installed Meta/Ads
   configuration. `.env.example` and CONNECTIONS.md have exact callbacks and
   settings. AI, Calendar, Meta and Ads credentials already exist; do not request
   or print them again. Do not publish the testing-only Google or Meta apps.
6. Verify UI settings persist with a staging owner and cannot be changed by a
   member or another workspace. Preserve the owner's current provider consent.
7. OpenAI routing/generation passed in workerd. Claude needs its API credit/usage
   limit resolved before retesting. Image/PDF live tests and a full authenticated
   chat/approval acceptance pass remain. Simulate failover rather than deliberately
   exhausting paid quota. Inspect safe Audit outcomes for new failures.
8. Obtain approval for one exact harmless Calendar test event. Verify Deny and
   retries/duplicates. No real Calendar event has yet been created.
9. Meta dashboard configuration is complete through owner-ready standard access
   on Graph API `v26.0`. Complete OAuth from Tradie AI, choose the exact GreenVac
   Page from the returned list, then verify the connected record without posting.
   Get exact test-post approval before enabling publishing in any environment.
   Do not auto-enable production publishing or post to a business Page as a test.
10. Basic Access is granted. Use the GreenVac Tradie AI workspace to consent,
    select advertiser `577-483-5580`, and verify
    the read-only report currency/time zone/period and manager context. Do not
    connect that advertiser to `Test 01 James`. Do not add spending mutations
    without new approved action schemas and budget-specific acceptance tests.
11. For further runtime changes, deploy the exact tested source through the
    linked Vercel project and verify the stable `tradie-ai-nine.vercel.app` alias.
    Keep `.env`, local databases and runtime state out of source control. The old
    Sites deployment is historical and is not the release target for this build.
12. Check live HTTP auth, two-user isolation, Storage, and authenticated browser
    workflows. Update this checkpoint with exact verified status and blockers.

## Tests and limits

Current verification: 151 automated tests in 15 suites; type check, lint, build
and zero-finding audit pass locally. Tests use PGlite for real SQL/RLS,
mocked provider/API services, and actual workerd request semantics. Real OpenAI
routing/generation passed in workerd; latest Claude call reports a quota error.
Meta and Ads runtime configuration is installed; Meta OAuth/Page selection and
Ads production account reporting remain unverified. Local signed-out browser
Connections/navigation checks passed on desktop and at a 390px phone viewport
(no horizontal overflow); a full authenticated settings UI pass remains.
Prior hosted Supabase password sign-in, two-user isolation and private Storage
HTTP checks passed with synthetic fixtures that were subsequently removed.

No Instagram, multiple Facebook photos, post scheduling, Facebook ads, Google Ads
mutations, invoice sending, external website publishing, billing, token balance
UI, persistent job queue, provider webhook processing, candidate cleanup cron,
operator reconciliation UI, production SMTP or full retention/export/deletion
process exists. Keep these marked as outstanding rather than claiming V1 does all.

## Safety details not to regress

- Owner approval is a separate endpoint/RPC, never a phrase inside chat.
- Payloads and connection IDs remain immutable after proposal creation.
- Browser roles cannot access credential/candidate/publish-marker tables or
  privileged RPCs. Service code authenticates the user and checks membership first.
- Tokens are encrypted with tenant/provider/connection binding (legacy Calendar
  binding is preserved). Never include credentials in model context or errors.
- `PUBLICATION_UNCERTAIN` blocks reposting. Do not delete/send-marker or label an
  uncertain send rejected just to retry. Verify the Page and resolve deliberately.
- Ask James receives categorical allowlisted payloads only when the owner opts in.
  Customer free text/attachments never become global skill updates automatically.
- Maintain user-facing truth: configured key ≠ verified live response.

## Useful files

`lib/server/ai-provider.ts`, `ai.ts`, `claude.ts`, `model-http.ts`,
`lib/ai-settings.ts`, `components/ai-settings.tsx`, `connections-panel.tsx`,
`lib/server/provider-oauth.ts`, `connections.ts`, `facebook.ts`, `google-ads.ts`,
`integration-api.ts`, `tests/ai-fallback.test.ts`, `integrations.test.ts`,
`database.test.ts`, `scripts/check-setup.mjs`.
