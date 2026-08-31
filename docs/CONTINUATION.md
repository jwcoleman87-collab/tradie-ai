# Tradie AI — continuation checkpoint for Claude or another engineer

Updated 31 August 2026 (Australia/Sydney). Read this before making changes.
The latest runtime changes are deployed privately. Do not restart setup.

## Logo update

The owner selected the blue four-tile mark from their screenshot. It replaces
the purple initial/sparkle branding in the header, welcome screen and favicon.
`public/favicon.svg` is the shared crisp vector source; its colours match the
reference. The existing three-panel purple/lilac theme is otherwise unchanged.
The social preview `public/og.png` now includes the same mark beside the title.
The selected branding is included in the live release.

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
- LIVE runtime source: `2b6d321887cf822e1a9825c81d67257e1246939a`.
- LIVE saved version: 6; hosting environment revision: 3.
- LIVE version ID: `appgprj_6a952d52f72c81919fa229c3f5f93e8c~appgver_186b391788688191ad44af085889a57b`.
- LIVE deployment: `appgdep_6a95630c67488191b4f3aecedd2c06a5`, succeeded.
- Later documentation-only commits may follow the runtime commit.
- Access last verified owner-only, custom, one user, zero groups/visitors.
- `.openai/hosting.json` is authoritative. Do not create a duplicate site.

## Missing credentials

Google Cloud is signed in as the owner. Project picker shows only Default Gemini
Project (`gen-lang-client-0084405105`) and My First Project (`just-turbine-393809`),
not a Tradie AI project. A dedicated-project creation form was prepared, but the
creation action was blocked for lack of explicit resource-creation approval.
**No Google project was created and neither existing project was changed.**
The owner has been asked to authorise creating a separate "Tradie AI" project
(one quota slot, persistent resource, no billing). Do not retry until approved;
do not repurpose the unrelated projects to bypass that approval. Google terms,
OAuth client creation/scopes and final Calendar consent will need their own
appropriate owner approvals. No Google credentials were created or obtained.

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, Calendar API/consent/test users.
- `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, supported
  `META_GRAPH_VERSION`, Page permissions/app review/business verification.
- `GOOGLE_ADS_DEVELOPER_TOKEN`; Ads API/consent and advertiser access. Optional
  separate `GOOGLE_ADS_CLIENT_ID`/`GOOGLE_ADS_CLIENT_SECRET`.

OpenAI and Anthropic keys, Supabase URL/publishable/server keys and encryption secret already exist in
ignored local `.env` and hosted settings. Do not print, overwrite, commit or
request them again. The Supabase server key and both AI keys supplied in chat
are exposed: coordinate rotation before customer data, update both environments, redeploy
and verify. Preserve the encryption key unless deliberately migrating tokens.
ChatGPT/Codex/Claude subscriptions do not supply backend API credits.

## Resume in this order

1. Inspect working-tree changes, this file, README, CONNECTIONS and VERIFICATION.
   Preserve any newer user changes. No unrelated repositories/databases are in scope.
2. Inspect migration history if changing the schema; 001–004 are already applied.
   Never reapply/reset production or disable append-only/RLS protections.
3. Run `npm run setup:check -- --remote`; require all four schema probes `ready`.
4. For code changes, run typecheck, lint, tests, production build and dependency audit.
   Use the existing lockfile/runtime; no dependency replacement is necessary.
5. Obtain Google OAuth, Meta and Ads setup through the owner's intended accounts.
   `.env.example` and CONNECTIONS.md have exact callbacks/settings. Both AI keys
   are already connected; do not request or print them again.
6. Verify UI settings persist with a staging owner and cannot be changed by a
   member or another workspace. Existing consent must remain OpenAI-only.
7. Text routing/generation for each AI provider is verified. Image/PDF live tests
   and a full authenticated chat/approval acceptance pass remain. Simulate failover
   in tests rather than deliberately exhausting paid quota.
8. Connect Calendar and approve one exact harmless test event. Verify Deny and
   retries/duplicates. No real Calendar event has yet been created.
9. Verify Meta permissions/version with the actual dashboard. Connect a test Page,
   get exact test-post approval, then enable publishing in that environment.
   Do not auto-enable production publishing or post to a business Page as a test.
10. Connect an eligible Google Ads test/advertiser account; verify read-only report
    currency/time zone/period and manager context. Do not add spending mutations
    without new approved action schemas and budget-specific acceptance tests.
11. For further runtime changes, deploy the exact tested source through the
    existing Sites workflow. Recheck owner-only access, push source, package `dist/`,
    save a version, deploy and poll success. Keep `.env`, local databases and
    runtime state out of the archive. Reuse the existing preview tab.
12. Check live HTTP auth, two-user isolation, Storage, and authenticated browser
    workflows. Update this checkpoint with exact verified status and blockers.

## Tests and limits

Current local verification: 106 automated tests; type check, lint, build and audit
pass. Tests use PGlite for real SQL/RLS execution plus mocked provider HTTP.
Live OpenAI/Claude routing and generation passed with synthetic text. Meta/Ads
remain unconfigured. Local signed-out browser
Connections/navigation checks passed on desktop and at a 390px phone viewport
(no horizontal overflow); a full authenticated settings UI pass remains.
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
