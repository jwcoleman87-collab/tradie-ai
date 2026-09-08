# Workbench UI integration baseline — 6 September 2026

Claude Design created the new Workbench design; Codex built the original application and integrated the agreed design into it. This release packages existing work for review. It does not introduce an independent redesign or begin onboarding work.

## Why this branch exists

`codex/ui-baseline-2026-09-06` captures the application immediately before the ten-file UI integration task. The starting committed source is `775b95db37f13fc17cf6a916427c9d49dc659608`, supplemented by the original pre-task source backup from 6 September. Those dependencies were previously uncommitted, so a UI-only commit against the existing remote branch would not contain a complete buildable application.

The baseline PR targets `main` and exposes the earlier application work for separate review. `codex/ui-review-2026-09-06` starts from this baseline; its draft PR targets this branch and contains only the focused ten-file UI integration. Neither PR should be merged automatically.

## Included application work

- Existing connector recovery, durable Chat processing, provider error handling and the `202609050009_chat_and_connection_lifecycle.sql` migration inherited from the starting commit.
- Existing Workbench identity, set-out, message and proposal presentation, mobile viewport and chat-scroll behaviour.
- Shared action-state and outcome components, action-data loading and the existing `publicAction` serializer; action execution, receipt recovery and coverage metadata.
- Record context, Finance coverage disclosure, existing specialist instructions and their regression/evaluation fixtures.
- Original `tests/action-execution.test.ts`, before the UI task's two cancel/replace response-serialization regression cases.
- Source documentation, source generators, application artwork and the brand reference image.

The baseline excludes the new voice draft controller/hook, composer Cancel/Keep integration, activity cluster/ribbon, Needs you / All / Done filters, UI-task keyboard/reduced-motion changes and cancel/replace serializer calls. Those belong in the UI PR. Existing onboarding code is retained without changes from `main`.

## Packaging boundaries

Preparation uses an isolated Git worktree. The original checkout, its index, uncommitted files and pre-task backups remain intact. Formatting of pre-existing files is confined to the isolated package; no application behaviour is changed by that normalization.

Credentials, local environment files, `.vercel`, dependency/build/cache directories, local verification fixtures and unrelated personal files are excluded. `.env.example` contains blank credential placeholders only. Generated `docs/d10-action-states.html` and `output/pdf/tradie-ai-google-ads-api-design.pdf` are excluded; their source generators remain. The retired `.openai/hosting.json` deployment registration is also omitted. Ignore rules prevent these generated/local files from being added accidentally.

## Preview isolation

The current Vercel project gives Preview and Production the same environment records, including Supabase and provider credentials. That configuration is unsuitable for the requested test-data preview. No production values are copied into this package.

`vercel.json` disables automatic Git deployment for these two exact review branches. Other branches retain their existing deployment behaviour. This prevents branch pushes from creating a preview backed by production services; it does not change the production branch or deployment.

A deployable preview requires a separate test Supabase project with the required schema, private Storage and a synthetic test user/workspace; its URL, anon key and service-role key; a separate encryption secret; and a test-only model provider key for live Chat. Publishing connectors should remain unconfigured unless dedicated test accounts are available. `APP_ORIGIN` must match the final preview hostname, and any enabled auth/OAuth redirects must be configured for that preview. Until those isolated settings exist, the preview is blocked rather than connected to production data.

The UI verification report describes the original checkout checks. Packaging checks and exact baseline/UI commit identifiers are recorded in the draft PRs after the isolated version is tested. Physical-phone keyboard, microphone permission/transcription and conversation-comfort checks remain outstanding. Onboarding must wait for the owner's phone review.
