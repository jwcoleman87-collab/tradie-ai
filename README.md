# Tradie AI

A V1 codebase for a managed business team: one conversation, five versioned
agents, private customer workspaces, and explicit approval before execution.

## Delivery status

Supabase Auth/Postgres/Storage and all five migrations are live. The private
hosted app includes the selected blue four-tile logo, OpenAI + Claude backup,
Facebook Page connections, approved single-photo publishing and read-only Google
Ads reporting.

The native Next.js production deployment is live on Vercel at
[tradie-ai-nine.vercel.app](https://tradie-ai-nine.vercel.app). The existing
ChatGPT Sites deployment remains untouched. The Vercel URL is public, while all
customer workspace data and actions remain behind Supabase authentication and
the existing row-level security policies.

Both AI keys are configured privately. A reported hosted chat failure was traced
to `redirect: 'error'`, which the Worker engine rejects before contacting either
provider. Manual redirect handling fixes that without forwarding credentials.
OpenAI passed real routing/generation inside the Worker engine; the latest Claude
test reports `AI_QUOTA_EXCEEDED` (HTTP 400), so its API credits/usage limit needs
attention despite earlier success. All 131 automated tests pass. Each workspace
must explicitly allow its chosen providers before AI processing.

Google Calendar API and the testing-only OAuth client are configured, with
credentials saved privately and activated in the hosted app. The owner is the
sole Google test user. The Meta app is configured and the owner workspace has a
selected Facebook Page. No Facebook post was sent while implementing or testing
single-photo publishing. Google received the reporting-only Google Ads Basic
Access application on 2026-09-01; production advertiser access and the final
GreenVac workspace connection remain pending provider review. Rotate the secrets
shared in chat before onboarding customer data.
Start with [the continuation checkpoint](docs/CONTINUATION.md),
[connection setup](docs/CONNECTIONS.md) and [verification](docs/VERIFICATION.md).

The original ChatGPT canvas source was not available in the referenced task,
local files, Sites projects or GitHub repositories. This implementation follows
the recovered visual brief: white/lilac/purple, rounded cards, left AI team,
central independently scrolling chat with a bounded composer, and right review
workspace. It is not claimed to be pixel-identical to the missing canvas. The UI
is isolated in `components/workspace.tsx` and `app/workspace.css` so the original
can be integrated without rebuilding the backend.

## Included

- Supabase email/password Auth, confirmation, privacy-safe password reset and
  server-verified JWTs.
- PostgreSQL migrations, tenant RLS, private Storage policies and durable records.
- Finance, Marketing, Social, Maintenance and Website Markdown skills. Exact
  version and SHA-256 are recorded on every successful agent run.
- Two-stage structured AI routing and generation through a replaceable provider
  interface: OpenAI Responses and Anthropic Messages, workspace consent per
  provider, preferred provider and bounded availability/quota fallback. No keyword
  router and no AI execution tools.
- Conversations, uploads, business records, proposals and execution receipts.
- Owner-only Accept/Deny, immutable payloads, atomic decisions, execution leases,
  manual retries, deterministic Google event IDs and duplicate reconciliation.
- Google OAuth with state, browser nonce, PKCE, encrypted refresh tokens and
  connection binding so an approval cannot silently target a changed account.
- Ask James Case ID → Problem → Solution → Outcome. Private by default; optional
  sharing sends categorical information only, never free text or files.
- Metadata-only audit logs, durable rate limits, file checks and actionable errors.
  Recent chat runs show outcomes, provider/model, HTTP status, timing and safe
  request references. No raw provider error body or customer text is logged.
- Saved messages clear the composer even when AI generation fails. Uncertain
  network outcomes retain the draft and reuse its request reference. Paused
  processing is explained beside the composer, with a settings shortcut.
- Independent Calendar, Facebook Page and Google Ads connections per workspace.
  Encrypted, expiring resource selection; no provider token reaches the browser.
- Separate business and sandbox workspaces with reversible conversation and
  record archives. Completed actions and resolved cases move out of active work;
  archive and restore events retain immutable audit evidence.
- Facebook immediate text/link or single JPEG/PNG photo publishing after owner
  approval; a durable sending marker blocks automatic reposts when the external
  outcome is uncertain. Private images are uploaded directly from Storage.
- Google Ads account selection and last-30-days campaign reporting, read-only.
  No advertising mutations, multiple-image publishing, scheduling or Instagram
  support yet.

## Quick start

Use Node.js 24 and npm. Everything belongs to this one repository.

```sh
npm ci
# Copy .env.example to .env if .env does not already exist, then fill its values.
npm run dev
```

Open the address printed by the server. Do not expose the development server to
the internet. No credentials are committed.

### Vercel

The repository is linked to the `tradie-ai` Vercel project. Vercel runs the
standard Next.js build and stores production configuration as encrypted project
environment variables. Deployments must keep `APP_ORIGIN` set to the exact
production origin:

`https://tradie-ai-nine.vercel.app`

For a fresh Vercel project, add every populated variable from `.env.example` in
the Vercel project settings, then deploy from the repository root. Never upload
the local `.env` file or expose server secrets with a `NEXT_PUBLIC_` prefix.

Before creating or reconnecting accounts on the Vercel domain, also allow the
Vercel origin in Supabase Auth and register these exact production callbacks in
their provider dashboards:

- `https://tradie-ai-nine.vercel.app/api/google/callback`
- `https://tradie-ai-nine.vercel.app/api/integrations/facebook/callback`
- `https://tradie-ai-nine.vercel.app/api/integrations/google_ads/callback`

### Supabase

Use a dedicated **staging** Supabase project for Tradie AI. Do not point these
migrations at PaddockMe, GreenVac or another existing product database.

```sh
npx supabase login
npx supabase link --project-ref YOUR_TRADIE_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Back up before migrating a populated database. For local Supabase, start Docker
Desktop then run `npx supabase start`. Run `npx supabase db reset` **only against
a disposable local development database**; it destroys local database data.

In Supabase Auth enable email/password and confirmation, set a 10-character
password minimum, configure SMTP, and set Site URL and allowed redirects to the
exact app origin. Configure these **server runtime** values:

| Variable                  | Source                              | Exposure      |
| ------------------------- | ----------------------------------- | ------------- |
| APP_ORIGIN                | Exact HTTPS app origin without path | Public        |
| SUPABASE_URL              | Project API URL                     | Public        |
| SUPABASE_ANON_KEY         | Publishable or legacy anon key      | Public        |
| SUPABASE_SERVICE_ROLE_KEY | Backend secret/service-role key     | Server only   |
| OPENAI_API_KEY            | Project-scoped API key with billing | Server only   |
| OPENAI_MODEL              | `gpt-5-mini` default; configurable  | Server config |
| ANTHROPIC_API_KEY         | Anthropic API key with credits      | Server only   |
| ANTHROPIC_MODEL           | `claude-haiku-4-5-20251001` default | Server config |
| GOOGLE_CLIENT_ID          | Google OAuth web client             | Server config |
| GOOGLE_CLIENT_SECRET      | Same OAuth client                   | Server only   |
| TOKEN_ENCRYPTION_KEY      | 32 random bytes, base64 encoded     | Server only   |

Local `.env` is loaded by the development tooling. Vercel uses encrypted project
variables; local `.env` is not part of the deployment. Add provider keys through
secure environment settings and never commit them. Keep the encryption key
stable and backed up; changing it invalidates existing stored connections.

API quotas are separate from chat subscriptions. Add both keys privately for
backup, then explicitly allow both providers under **Connections → AI connections**.
Fallback works only on the providers this workspace allows. Provider requests
may still cost money on a timeout; switching is not free or unlimited usage.
See [all provider variables and callbacks](docs/CONNECTIONS.md).

### Google Calendar

1. Enable Google Calendar API in a Google Cloud project.
2. Configure OAuth consent and test users while the app is in testing mode.
3. Create a Web Application OAuth client. Allow exactly
   `https://YOUR_APP_ORIGIN/api/google/callback` and localhost for development.
4. Configure the client credentials and encryption key on the backend.
5. Sign in to Tradie AI and press **Connect** beside Google Calendar.

Scope: `https://www.googleapis.com/auth/calendar.events`. The app reads busy
periods on the primary calendar for the next 14 days and creates events only
after approval. No attendees or notification emails are requested. Other
calendars and dates are unverified. Reconnecting changes the connection identity;
old proposals cannot execute against a different account. Disconnect deletes
the app's stored token. Revoke Google-side access separately in Google Account
permissions if desired. Google production verification is an account-owner step.
A personal ChatGPT Calendar connector cannot replace customer-facing app OAuth.

## First real workflow

1. Create and confirm an account, then create a private business workspace.
2. Open Connections, choose and allow AI providers, enable processing, and save.
   Connect Google Calendar separately.
3. Give the exact booking date, time and time zone, and the machine facts.
4. Review the exact start/end, UTC offset, IANA zone and event contents.
5. Accept. This records approval then calls the separate execution endpoint.
6. Verify the event and audit receipts. Deny leaves Calendar unchanged.

Accept on a private draft saves it privately. A distinct `facebook.publish`
proposal shows the exact Page ID, text and link and says **Publish to Facebook**;
that approval publishes only when the feature is explicitly enabled and the
selected Page remains connected. Other drafts do not send invoices, spend on ads
or publish website changes.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
npm run setup:check
# Optional read-only live schema check; prints readiness, never secrets:
npm run setup:check -- --remote
```

PostgreSQL tests use PGlite and minimal Supabase Auth/Storage table stubs. They
execute actual migrations and RLS under different database roles, not SQL string
assertions. They do not validate hosted Auth, Storage HTTP or Google OAuth.

For read-only staging checks set `TEST_APP_ORIGIN`, `TEST_USER_A_TOKEN` and
`TEST_USER_B_TOKEN` for two unrelated test workspaces, then `npm run test:live`.
Without those values live tests skip explicitly. CI runs type checks, the test
suite, production build and dependency audit.

The transport regression runs the real helper inside `workerd` via Miniflare,
not just Node's fetch implementation. API receipt tests verify failure audit,
idempotent replies and safe database/case errors. See
[chat troubleshooting](docs/CHAT-TROUBLESHOOTING.md) for diagnostic boundaries.

## Operational boundaries

- Ask James cases are saved and optionally queued centrally. No email/SMS
  delivery, scheduled case sweeper, shared-learning pool or autonomous case
  resolution is configured. Escalation never grants execution approval.
- Register support users out-of-band in `support_operators`. `/api/support`
  exposes only approved categorical packages, not private workspaces. There is
  no self-service admin elevation or customer access to managed skill sources.
- UI limits: latest 200 messages; 100 conversations/actions/files/records/cases;
  30 audit entries and ten recent runs for the selected conversation. Older
  records stay in Postgres. AI context is bounded to 30
  recent messages/65k text, 30 business records, and four current attachments
  totalling 20 MB. This is not unlimited memory or semantic document search.
- Uploads: JPEG, PNG, WebP, PDF, UTF-8 TXT/CSV; 10 MB each. Signature and size
  checks are not antivirus. Malware scanning and OCR indexing are not included.
- Consent is explicit and revocable for future turns. `store:false` does not
  guarantee provider zero retention. Publish a privacy/retention policy and
  review provider terms before onboarding customers.
- Existing consent remains OpenAI-only after migration. Claude needs an explicit
  owner opt-in. Backup never routes around a safety refusal or invalid output.
- Expired OAuth candidates cannot be selected. Their encrypted rows require a
  documented operator retention/cleanup policy; no background cleanup job exists.
- Server-role credentials remain powerful. Staff with those credentials retain
  technical access. RLS and the limited support view do not eliminate that
  administrative capability. Use controlled access, rotation and backups.
- Review migrations and bump skill versions for releases. Reusing a skill
  version with changed contents is rejected by the database.

See `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md` and `docs/VERIFICATION.md`.
The operational archive and retention baseline is documented in
`docs/WORKSPACE-GOVERNANCE.md`.

## Primary implementation references

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase server-verified user](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API errors](https://developers.openai.com/api/docs/guides/error-codes)
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude API errors](https://platform.claude.com/docs/en/api/errors)
- [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
