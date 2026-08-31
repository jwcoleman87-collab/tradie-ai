# Verification — 31 August 2026

## Passed locally

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

## Not verified live

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
