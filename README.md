# Tradie AI

A V1 codebase for a managed business team: one conversation, five versioned
agents, private customer workspaces, and explicit approval before execution.

## Delivery status

Product code and migrations are implemented. Live Supabase, OpenAI and Google
calls require the project credentials below. Without them, the application shows
a labelled setup state; it does not pretend mock responses or sample records are
live. See `docs/ENVIRONMENT.md` and `docs/VERIFICATION.md` for the access inventory
and exactly what was tested.

The original ChatGPT canvas source was not available in the referenced task,
local files, Sites projects or GitHub repositories. This implementation follows
the recovered visual brief: white/lilac/purple, rounded cards, left AI team,
central independently scrolling chat with a bounded composer, and right review
workspace. It is not claimed to be pixel-identical to the missing canvas. The UI
is isolated in `components/workspace.tsx` and `app/workspace.css` so the original
can be integrated without rebuilding the backend.

## Included

- Supabase email/password Auth, confirmation and server-verified JWTs.
- PostgreSQL migrations, tenant RLS, private Storage policies and durable records.
- Finance, Marketing, Social, Maintenance and Website Markdown skills. Exact
  version and SHA-256 are recorded on every successful agent run.
- Two-stage structured AI routing and generation through a replaceable provider
  interface. No keyword router and no AI execution tools.
- Conversations, uploads, business records, proposals and execution receipts.
- Owner-only Accept/Deny, immutable payloads, atomic decisions, execution leases,
  manual retries, deterministic Google event IDs and duplicate reconciliation.
- Google OAuth with state, browser nonce, PKCE, encrypted refresh tokens and
  connection binding so an approval cannot silently target a changed account.
- Ask James Case ID → Problem → Solution → Outcome. Private by default; optional
  sharing sends categorical information only, never free text or files.
- Metadata-only audit logs, durable rate limits, file checks and generic errors.

## Quick start

Use Node.js 24 and npm. Everything belongs to this one repository.

```sh
npm ci
# Copy .env.example to .env if .env does not already exist, then fill its values.
npm run dev
```

Open the address printed by the server. Do not expose the development server to
the internet. No credentials are committed.

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
| GOOGLE_CLIENT_ID          | Google OAuth web client             | Server config |
| GOOGLE_CLIENT_SECRET      | Same OAuth client                   | Server only   |
| TOKEN_ENCRYPTION_KEY      | 32 random bytes, base64 encoded     | Server only   |

Local `.env` is loaded by the development tooling. For hosted Sites use hosted
runtime variables/secrets; local `.env` is never uploaded. OpenAI Developers key
provisioning was unavailable in the build environment. Enable that plugin for
assisted provisioning, or add a project key through secure environment settings.
Never paste secrets into chat. Keep the encryption key stable and backed up;
changing it invalidates existing stored connections.

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
2. Read and accept AI processing consent; connect Google Calendar.
3. Give the exact booking date, time and time zone, and the machine facts.
4. Review the exact start/end, UTC offset, IANA zone and event contents.
5. Accept. This records approval then calls the separate execution endpoint.
6. Verify the event and audit receipts. Deny leaves Calendar unchanged.

For invoices, social posts, campaigns and website changes, Accept saves a
private draft or owner-supplied record. It does **not** send invoices, publish
posts, spend on ads or publish website changes. Those connectors are not built.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

PostgreSQL tests use PGlite and minimal Supabase Auth/Storage table stubs. They
execute actual migrations and RLS under different database roles, not SQL string
assertions. They do not validate hosted Auth, Storage HTTP or Google OAuth.

For read-only staging checks set `TEST_APP_ORIGIN`, `TEST_USER_A_TOKEN` and
`TEST_USER_B_TOKEN` for two unrelated test workspaces, then `npm run test:live`.
Without those values live tests skip explicitly. CI runs type checks, the test
suite, production build and dependency audit.

## Operational boundaries

- Ask James cases are saved and optionally queued centrally. No email/SMS
  delivery, scheduled case sweeper, shared-learning pool or autonomous case
  resolution is configured. Escalation never grants execution approval.
- Register support users out-of-band in `support_operators`. `/api/support`
  exposes only approved categorical packages, not private workspaces. There is
  no self-service admin elevation or customer access to managed skill sources.
- UI limits: latest 200 messages; 100 conversations/actions/files/records/cases;
  30 audit entries. Older records stay in Postgres. AI context is bounded to 30
  recent messages/65k text, 30 business records, and four current attachments
  totalling 20 MB. This is not unlimited memory or semantic document search.
- Uploads: JPEG, PNG, WebP, PDF, UTF-8 TXT/CSV; 10 MB each. Signature and size
  checks are not antivirus. Malware scanning and OCR indexing are not included.
- Consent is explicit and revocable for future turns. `store:false` does not
  guarantee provider zero retention. Publish a privacy/retention policy and
  review provider terms before onboarding customers.
- Server-role credentials remain powerful. Staff with those credentials retain
  technical access. RLS and the limited support view do not eliminate that
  administrative capability. Use controlled access, rotation and backups.
- Review migrations and bump skill versions for releases. Reusing a skill
  version with changed contents is rejected by the database.

See `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md` and `docs/VERIFICATION.md`.

## Primary implementation references

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase server-verified user](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
