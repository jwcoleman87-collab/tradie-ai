# Tradie AI — continuation checkpoint for Claude or another engineer

Updated 31 August 2026 (Australia/Sydney). Read this before making changes.
This file describes the current checkout; the hosted app is an earlier release.

## Logo update

The owner selected the blue four-tile mark from their screenshot. It replaces
the purple initial/sparkle branding in the header, welcome screen and favicon.
`public/favicon.svg` is the shared crisp vector source; its colours match the
reference. The existing three-panel purple/lilac theme is otherwise unchanged.
The social preview `public/og.png` now includes the same mark beside the title.
This branding update does not remove the pending database migration gate below.

## User intent

Continue the existing three-panel Tradie AI business team without redesigning it.
Complete real connections for OpenAI and Claude, Google Calendar, Facebook
socials and Google Ads. OpenAI and Claude should back each other up if API quota
or availability fails. Preserve private customer workspaces, managed Markdown
agents, Proposed Actions, owner Accept/Deny, audit and privacy-safe Ask James.
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
  the latest trace. No balances or exact cost calculation is claimed.
- Google Calendar OAuth/primary-calendar event creation with deterministic IDs.
- Separate Calendar/Facebook/Ads connections, encrypted expiring resource picker,
  owner-only connect/disconnect and exact connection identity binding.
- Facebook immediate text/link posting after explicit Publish approval; write-
  ahead receipt blocks duplicate POSTs after uncertain results or crashes.
- Google Ads account discovery and read-only last-30-days campaign reports.
- Connections panel includes AI consent/settings, provider setup states,
  account/Page selection and Ads reporting; original colours/layout preserved.

## Exact release blocker — do not overlook

Live Supabase has **only 001 and 002**. These new files are tested but NOT applied:

1. `supabase/migrations/202608310003_multi_provider_connections.sql`
2. `supabase/migrations/202608310004_ai_provider_preferences.sql`

The application’s configured Supabase server key can read/write application
data but cannot authenticate the Supabase CLI, run arbitrary SQL, or serve as a
database password. CLI management access is absent. The previously signed-in
dashboard session signed out and Chrome is unavailable. A fresh in-app visit
to the selected project shows sign-in. The owner has been asked to sign in.

Do NOT deploy current source before the migration gate passes: `/api/state`,
chat and integration routes now expect new columns/tables. Existing live version
3 was deliberately left intact. Local signed-out UI works; authenticated local
requests against the unmigrated live database are not release-ready.

## Known identities (not secrets)

- GitHub: https://github.com/jwcoleman87-collab/tradie-ai (private).
- Supabase: `gjrhukwqagaawdklnvxd`, Tradie Ai, Singapore.
- Site: https://tradie-ai-business-team.j-w-coleman87.chatgpt.site
- Sites project: `appgprj_6a952d52f72c81919fa229c3f5f93e8c`.
- Last LIVE source: `7adb23dae3979da1509da76903edc796995c156f`.
- Last LIVE saved version: 3; hosting environment revision: 2.
- Last LIVE deployment: `appgdep_6a9544d91ed4819196c4196ea0162bea`, succeeded.
- Access last verified owner-only, custom, one user, zero groups/visitors.
- `.openai/hosting.json` is authoritative. Do not create a duplicate site.

## Missing credentials

- `OPENAI_API_KEY` with API billing/model permission.
- `ANTHROPIC_API_KEY` with Anthropic API credits/model permission.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Calendar API/consent/test users.
- `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, supported
  `META_GRAPH_VERSION`, Page permissions/app review/business verification.
- `GOOGLE_ADS_DEVELOPER_TOKEN`; Ads API/consent and advertiser access. Optional
  separate `GOOGLE_ADS_CLIENT_ID`/`GOOGLE_ADS_CLIENT_SECRET`.

Supabase URL/publishable/server keys and encryption secret already exist in
ignored local `.env` and hosted settings. Do not print, overwrite, commit or
request them again. The Supabase server key supplied earlier in chat is exposed:
coordinate rotation before customer data, update both environments, redeploy
and verify. Preserve the encryption key unless deliberately migrating tokens.
ChatGPT/Codex/Claude subscriptions do not supply backend API credits.

## Resume in this order

1. Inspect working-tree changes, this file, README, CONNECTIONS and VERIFICATION.
   Preserve any newer user changes. No unrelated repositories/databases are in scope.
2. Restore intended Supabase management authentication. Inspect migration history,
   back up if populated, apply only 003/004 in order and record them atomically.
   Never reset production or disable append-only/RLS protections for convenience.
3. Run `npm run setup:check -- --remote`; require all four schema probes `ready`.
4. Run `npm ci`, typecheck, lint, tests, production build and dependency audit.
   Use the existing lockfile/runtime; no dependency replacement is necessary.
5. Set provider secrets privately. `.env.example` and CONNECTIONS.md have exact
   callbacks/settings. OpenAI Developers provisioning was unavailable here.
6. Verify UI settings persist with a staging owner and cannot be changed by a
   member or another workspace. Existing consent must remain OpenAI-only.
7. Live-test each AI provider with harmless input and an image/PDF; verify trace.
   Simulate failover in tests rather than burning paid quota deliberately.
8. Connect Calendar and approve one exact harmless test event. Verify Deny and
   retries/duplicates. No real Calendar event has yet been created.
9. Verify Meta permissions/version with the actual dashboard. Connect a test Page,
   get exact test-post approval, then enable publishing in that environment.
   Do not auto-enable production publishing or post to a business Page as a test.
10. Connect an eligible Google Ads test/advertiser account; verify read-only report
    currency/time zone/period and manager context. Do not add spending mutations
    without new approved action schemas and budget-specific acceptance tests.
11. Deploy the exact tested source through existing Sites hosting workflow after
    the database gate. Recheck owner-only access, push source, package `dist/`,
    save a version, deploy and poll success. Keep `.env`, local databases and
    runtime state out of the archive. Reuse the existing preview tab.
12. Check live HTTP auth, two-user isolation, Storage, and authenticated browser
    workflows. Update this checkpoint with exact verified status and blockers.

## Tests and limits

Current local verification: 100 automated tests; type check, lint, build and audit
pass. Tests use PGlite for real SQL/RLS execution plus mocked provider HTTP.
No live OpenAI/Claude/Meta/Ads calls have been made. Local signed-out browser
Connections/navigation checks passed on desktop and at a 390px phone viewport
(no horizontal overflow); protected settings await live migrations.
Prior hosted Supabase password sign-in, two-user isolation and private Storage
HTTP checks passed with synthetic fixtures that were subsequently removed.

No Instagram, Facebook photos, post scheduling, Facebook ads, Google Ads
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
