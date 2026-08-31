# Verification — 31 August 2026

## Activation and live provider verification

All four migrations are live. Chrome dashboard SQL verified 21/21 application
tables have RLS, browser roles lack new private-table grants and privileged RPC
execution, and the original one user/workspace and OpenAI-only consent survived.
The readiness check confirms all four new schema probes are ready.

Both privately configured keys passed real routing and generation using synthetic
fictional-business text. Each produced a validated private draft proposal; nothing
was saved or published by that test. This revealed unsupported `oneOf` schemas
in both APIs and an unsupported OpenAI URL format. The shared transport converter
fixes these without relaxing original server-side Zod validation. Six regression
tests cover the actual action union, schema-keyword property names and invalid
calendar semantics. **106 tests in eight suites**, typecheck, lint, build and zero-
finding dependency audit pass. Clean Linux CI also passed for deployed source:
https://github.com/jwcoleman87-collab/tradie-ai/actions/runs/33385962688.

Private Sites version 6 is deployed from `2b6d321887cf822e1a9825c81d67257e1246939a`
with environment revision 3. Secrets were scanned against 226 source/build files:
no matches; `.env` is ignored and excluded from the release archive.

After deployment, hosted HTTP checks passed page/config/health, both provider
readiness flags, logo availability and no server secrets in public config. Two
temporary users signed in successfully and each saw only its own workspace;
cross-workspace requests returned 403, missing/invalid sessions returned 401,
and direct browser writes were denied. Private Storage round-tripped a synthetic
file and denied anonymous/other-workspace downloads. Both temporary users,
workspaces and the file were removed successfully without weakening audit/RLS.

Fallback is validated with simulated quota/rate/service errors in both directions;
real provider quota was not intentionally exhausted. Live image/PDF handling,
full authenticated chat/approval UI acceptance, Google OAuth, Meta and Ads are
still outstanding. No real Facebook post, advertising mutation or Calendar event
was made. Keys supplied in chat must be rotated before customer onboarding.

Transport fix follows the supported structured-output subsets in the official
[OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs) and
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
documentation. The setup checker itself does not make paid model calls.

## Earlier integration checkpoint (historical; superseded above)

The current checkout passes type check, lint, **100 tests across seven suites**,
production build and dependency audit (zero known vulnerabilities). The tests
execute all four migrations in isolated PostgreSQL/PGlite. Added coverage:

- Explicit per-provider consent, OpenAI-only migration defaults and key readiness.
- OpenAI→Claude and Claude→OpenAI quota/rate/service fallback; sticky backup;
  no fallback on refusal, invalid input/output, key, permissions or token truncation.
- Claude text/image/PDF conversion, structured requests and original validation.
- Metadata-only provider traces, usage counts and no private key in public config.
- Multiple independent provider connections; private encrypted selection storage;
  expired, other-owner and duplicate selection rejection.
- Facebook exact Page/tenant binding, approval gates, durable sending markers,
  uncertainty/crash duplicate prevention and confirmed receipt replay.
- Read helpers reject arbitrary paths/mutations; large Ads metrics remain exact
  strings and missing conversions remain distinct from zero.

Local signed-out browser checks confirm the three-panel interface renders and
Connections can be opened; processing, uploads and private settings remain
unavailable until sign-in. Phone-sized (390px) Workspace → Connections navigation
passes with no horizontal overflow; the temporary viewport was restored.
Protected new settings have not been tested against
the live schema because the two new migrations are pending. A Markdown hot-reload
issue was found during local checking and the Vite asset handling was corrected.

The live Supabase project retains migrations 001/002 and the hosted site retains
source `7adb23dae3979da1509da76903edc796995c156f` / version 3. The setup checker
confirmed the new schema columns/tables are absent. The dashboard is signed out
and the prior Chrome connection is unavailable; the application service key
does not provide database migration-management access. **Do not deploy this
checkout until migrations 003/004 have been applied.**

No live OpenAI, Claude, Google OAuth, Meta or Ads calls were made; their required
keys/client credentials are missing. Mocked provider tests do not prove live
account/model access. No post, advertising mutation or Calendar booking was made.

Earlier live Supabase checks passed password sign-in, two-workspace isolation,
API authentication, browser write denial and private Storage HTTP round trips.
Synthetic users/workspaces/files were cleaned without disabling audit guards.
Email delivery, full authenticated UI acceptance and provider test resources
remain outstanding. See `CONNECTIONS.md` and `CONTINUATION.md`.

## Earlier baseline verification (before this integration update)

- TypeScript type check.
- Lint covers product code; generated shadcn components are excluded and
  React-Compiler-only checks are disabled (this app does not enable that compiler).
- 53 automated tests across five suites.
- Production Worker-compatible build.
- Dependency audit: zero known vulnerabilities after updating the starter's
  React, Vinext, Vite and Cloudflare tooling to patched releases.
- HTTP checks: application returns 200; public configuration reports the true
  unconfigured state; unauthenticated private-state request returns 401.
- The same HTTP checks pass against the packaged production Worker locally,
  not only the development server. The compatibility date is pinned to the
  runtime in the lockfile.
- Packaged-server test state is kept outside the distributable build directory.
  Release archives are checked for environment files and local database state.
- Clean Linux GitHub CI passed install, type checking, all 53 tests, production
  build and dependency audit.

The test suite executes both migration files in isolated PostgreSQL/PGlite.
Coverage includes RLS on every application table, customer A/B isolation,
membership escalation prevention, browser write/privileged-RPC denial,
private storage reads, owner-only decisions, expiry, duplicate approvals,
exclusive execution claims, immutable approved payloads, failed-action cases,
stale-lease recovery, account-connection binding, append-only receipts, AI
consent, idempotent chat, cross-tenant attachments, durable rate limits,
limited support payloads, linked resolutions and single-use OAuth state.

Unit/provider tests cover multi-agent routing, version hashes, rejection of
unselected agents, non-stored structured model requests, date/time validation,
unknown actions, upload signatures/limits, encryption tenant binding/tampering,
cross-origin mutations, bounded JSON and safe public configuration/errors.

## Earlier baseline exclusions (see current update above for Supabase progress)

- Hosted Supabase project migrations, Auth email delivery and Storage HTTP.
- Live OpenAI generation, billing/model access and real document/image reasoning.
- Google OAuth consent, token refresh and event creation against a real account.
- Cross-device behaviour and interactive browser acceptance tests.

The two opt-in live read-only tests are skipped without staging URL and two
test-user access tokens. Tests with mocked model responses are not claims that
live AI is connected. PGlite Auth/Storage schema stubs do not replace Supabase
integration tests. No real Calendar event was created.

## Go-live checklist

1. Configure a dedicated Supabase staging project and apply reviewed migrations.
2. Verify two real test users cannot access each other's records or storage URLs.
3. Verify email confirmation, sign-in, sign-out and expired-token handling.
4. Enable project-scoped AI access; test image/PDF inputs and invalid responses.
5. Complete Google OAuth; create a harmless approved test booking and verify
   Deny, repeated Accept, retry after timeout and changed-connection rejection.
6. Test phone layout, long-chat scrolling, fixed input, uploads and approval cards.
7. Configure production SMTP, OAuth verification, monitoring, backup/restore,
   retention/deletion/export procedures and provider privacy disclosures.
