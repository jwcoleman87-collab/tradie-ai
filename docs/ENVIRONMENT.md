# Development environment inventory — 31 August 2026

## Current state (supersedes initial discovery below)

All four migrations are applied and verified. Both AI keys are configured
privately in local/hosted settings. The hosted transport/composer/audit repair
and blue logo are live in private Sites version 7, environment revision 4.
OpenAI passed real routing/generation inside workerd; the latest Claude call
reports an API quota/credit error. Google credentials and a connected account
are present; Meta/Ads credentials are still missing. Rotate the AI
and Supabase secrets shared in chat before customer data. See CONTINUATION.md
for exact identities and VERIFICATION.md for current evidence.

Google follow-up: the authorised dedicated project `tradie-ai-507211` (Tradie AI)
is created. No billing was enabled and unrelated projects were not changed.
The owner approved Google's three agreements. Calendar API is enabled; External /
Testing OAuth, the web client and exact hosted/local callbacks are saved. Only the
owner is a test user and only Calendar events is declared. Google credentials are
saved privately in local/hosted settings and deployed. Live configuration reports
Calendar ready; a metadata-only read confirms a connected Calendar record created
at `2026-08-31T12:10:27.329955+00:00`. No token was inspected. Production branding,
token-refresh verification and a separately approved event test remain. No event
was created during setup or this repair.

## Earlier environment checkpoint (historical; superseded above)

- Repository: `outputs/tradie-ai`; private GitHub repository
  [jwcoleman87-collab/tradie-ai](https://github.com/jwcoleman87-collab/tradie-ai).
- Hosted site is connected to Supabase project `gjrhukwqagaawdklnvxd` (Tradie Ai).
  Migrations 001/002 and private Storage are live. Supabase URL, publishable key,
  server key and a stable encryption secret exist in ignored local `.env` and
  hosted settings. No unrelated project's secrets were used.
- The owner explicitly authorised using the supplied Supabase keys. The server
  key appeared in chat and must be rotated before customer data; rotation is
  not done and requires coordinated local/hosted updates.
- Sites access was rechecked: owner role, custom access, one allowed user, no
  groups and zero external visitors. Sharing has not been broadened.
- OpenAI + Claude fallback, multi-provider connections, Facebook approved text
  publishing and Ads read-only reports are implemented locally, not yet deployed.
- Missing: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Google OAuth client credentials,
  Meta app/business-login configuration and Google Ads developer token.
- Supabase CLI was unauthenticated. Its prior signed-in browser session has
  expired; the in-app dashboard now shows sign-in and Chrome is unavailable.
  Service API access remains available but cannot apply SQL migrations.
- Pending migrations 003/004 are locally tested. The owner needs to restore
  authenticated management access before the release can be deployed safely.
- `npm run setup:check -- --remote` reports presence/readiness without exposing
  secrets or reading customer rows. Check current state rather than assuming
  a previous key-presence report proves a live provider request.

## Initial discovery record (historical)

## Available and verified

- Windows local workspace; Node 24.12.0, npm 11.6.2, Git, GitHub CLI, Python,
  pnpm and Docker CLI are installed.
- GitHub connector and local CLI identify `jwcoleman87-collab`. Local CLI is
  authenticated for repository operations. Repository metadata reports admin and
  push access to the listed repositories.
- Build source is saved in the new private repository
  https://github.com/jwcoleman87-collab/tradie-ai with automated verification.
- A project-specific encryption key was generated into the ignored local
  environment file. It is not committed or included in the deployment archive.
- Existing repositories: BoardRoomAi, BoardRoomAiv2, BoardRoomAiv3, Quote-builder,
  GreenVacWebSite, Gatsby, creature, paddockme, electrocore-site. None is Tradie AI.
- Saved local projects include paddockme, photos, electrocore-site, greenvac,
  creature and New project. These unrelated projects were not modified.
- Sites connector is available. The two existing Sites are unrelated Open Card
  projects and were not reused.
- Chrome connection can read the original Brainstorming Idea task, including its
  detailed visual/architecture brief. Task retrieval supplies no downloadable
  prototype source or attachment. No local Tradie AI source was located in the
  scoped project, Documents/Codex, New project, Downloads or filename searches.

## Blocked / not verified

- Supabase project listing through the CLI returns Unauthorized. The browser
  dashboard redirects to sign-in; continuing with GitHub requires interactive
  sign-in. No intended Tradie AI project or migration authority is established.
- No Tradie AI Supabase URL/public/server keys, OpenAI API key, Google OAuth
  client credentials or encryption key were present in this workspace or the
  environment. Secrets from other projects were not copied or displayed.
- Docker Desktop engine is not running. Local Supabase could not start; actual
  migrations were instead exercised using isolated PostgreSQL/PGlite tests.
- No callable Supabase or Google Calendar product connector was found in the
  available tool inventory. Plugin discovery/suggestion tools were unavailable.
  A Calendar chat connector would not supply customer-facing OAuth credentials.
- OpenAI Developers API-key provisioning skill was not available. A dedicated
  API key and API billing are still needed; a ChatGPT subscription is not used
  as a backend credential.

## Required owner steps

1. Sign in to Supabase and identify/create the intended Tradie AI project.
2. Provide project configuration through secure runtime environment settings;
   authorise applying the migrations to that exact project.
3. Add a project-scoped OpenAI API key with billing enabled.
4. Create/approve the Google Cloud OAuth client and authorised callback, then
   connect Calendar from the app. Do not send passwords or secrets in chat.

No existing Supabase production database was changed, no real Calendar booking
was created, and no unrelated repository was altered during this build.
