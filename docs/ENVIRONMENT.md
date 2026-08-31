# Development environment inventory — 31 August 2026

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
