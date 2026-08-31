# Connection setup — OpenAI, Claude, Calendar, Facebook and Google Ads

All keys belong in ignored local `.env` and hosted **server secrets**, never in
browser code, chat, Git, screenshots or a customer-facing key entry field.
See `.env.example` for the complete variable list. The server is this Vinext
application, not a second service that needs a separate deployment.

## 0. Database setup is complete for this project

The selected project is [Tradie Ai](https://supabase.com/dashboard/project/gjrhukwqagaawdklnvxd).
Migrations `202608310001_core`, `202608310002_operational_audit`,
`202608310003_multi_provider_connections` and `202608310004_ai_provider_preferences`
are all live and verified. Do not reset the database or re-run these migrations.
The instructions below explain setup for a new environment or future migration.

Use the CLI migration history where available. If the SQL editor is used, apply
each complete migration in a transaction and record its version/name/statements
in `supabase_migrations.schema_migrations` in that same transaction. Verify the
history before resuming the CLI to avoid reapplying the files.

Migration 003 preserves existing Calendar ciphertext and adds a composite
workspace/provider identity, encrypted temporary account selections, Facebook
approval guards, durable publishing receipts and AI usage/trace metadata.
Migration 004 adds provider-specific consent. Existing consent stays OpenAI-only.

Run `npm run setup:check -- --remote`. Every schema check must say `ready` before
deploying this source. It performs only empty-result REST reads and prints no
credentials or customer rows. The Supabase service key works for application
data, but is **not** a CLI login, database password or management API token.

## 1. OpenAI

Current project: key configured privately and real text routing/generation
verified. Do not request the key again. These steps are for rotation/new setup.

1. Open [OpenAI API keys](https://platform.openai.com/api-keys) in the intended
   project. Configure API billing and project budget alerts separately.
2. Create/reuse a project-scoped key privately. Set secret `OPENAI_API_KEY` in
   local and hosted runtime settings. An OpenAI Developers provisioning skill can
   assist when installed; it was unavailable during this build.
3. Optional settings: `OPENAI_MODEL=gpt-5-mini`,
   `OPENAI_MAX_OUTPUT_TOKENS=5000`. Choose a model that supports Responses,
   structured outputs and the files your customers use; verify project access.
4. After deploying/restarting, Connections reports key **configured**, not
   verified. Enable OpenAI for a test workspace, send a harmless request and
   inspect the AI audit trace before calling it live.

## 2. Claude / Anthropic backup

Current project: key configured privately and real text routing/generation
verified. Workspace provider consent remains an explicit owner choice.

1. Open [Claude Console](https://platform.claude.com/) and use the intended
   organisation/workspace API keys and billing pages. Add API credits/limits.
2. Set secret `ANTHROPIC_API_KEY`. Defaults:
   `ANTHROPIC_MODEL=claude-haiku-4-5-20251001`,
   `ANTHROPIC_MAX_OUTPUT_TOKENS=5000`.
3. Open **Connections → OpenAI + Claude** in Tradie AI. Allow either or both,
   choose the first-choice provider, choose whether backup is allowed, enable AI
   processing, and press **Save AI preferences**. Only the workspace owner can
   change this. Existing OpenAI permission does not imply Claude permission.
4. Verify a harmless Claude-only request, then both-provider operation. Do not
   intentionally exhaust paid credits: automated tests simulate provider failures.

### Exact backup behaviour

- Primary is tried first when configured and allowed. If it is unconfigured,
  an allowed configured backup may be selected immediately when backup is enabled.
- A quota/credit error, rate limit, network failure, or upstream 5xx may switch
  once to the other configured, consented provider. The request stays on backup.
- No switch for safety refusal, incomplete/max-output-token response, invalid
  JSON/schema, invalid keys, forbidden access, unavailable model or bad request.
- One routing call + one generation call; at most three total attempts across
  at most two providers. No loop, parallel race, background retries or key sharing.
- `AI_REQUEST_TIMEOUT_MS` defaults to 30000, allowed range 1000–45000 per call.
  Output limits are 256–8000 tokens per call. These caps are not a financial
  guarantee; enforce billing limits/alerts at both providers too.
- Audit shows provider/model and safe error codes. Run usage records provider-
  reported counts, not account balances or an exact cost calculation. Usage for
  an upstream timeout may be unknown even if that provider bills the request.
- Both providers may receive relevant business context if both are allowed.
  Pausing/revoking affects new requests, not data already transmitted.
- ChatGPT/Codex usage and a Claude chat subscription do not fund these API keys.

## 3. Google Calendar

The owner authorised a separate project; [Tradie AI (`tradie-ai-507211`)](https://console.cloud.google.com/home/dashboard?project=tradie-ai-507211)
is created. Billing was not enabled and existing projects were not modified.
Reuse this project. Calendar API activation and Google Auth Platform setup
remain pending the owner's Google terms/consent approvals. No Google client
credentials or Calendar account connection exist yet.

The branding form has been prepared with app name Tradie AI, the owner's Google
email as support/contact and External/Testing audience, but is not submitted.
The final User Data Policy checkbox remains unchecked. The owner must approve
the [API terms](https://console.cloud.google.com/tos?id=universal),
[Calendar terms](https://console.cloud.google.com/tos?id=calendar) and
[User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
before completing this setup. Prepared form values may not survive tab cleanup.

1. In [Google Cloud Console](https://console.cloud.google.com/), select the
   intended project, enable Google Calendar API and configure Google Auth Platform.
2. Create a Web Application OAuth client. Add the hosted redirect exactly:
   `https://tradie-ai-business-team.j-w-coleman87.chatgpt.site/api/google/callback`.
   For local testing add `http://localhost:3000/api/google/callback` separately.
3. Set `GOOGLE_CLIENT_ID`, secret `GOOGLE_CLIENT_SECRET`, and the exact
   `APP_ORIGIN`. Preserve the existing secret `TOKEN_ENCRYPTION_KEY`.
4. Add the intended test user while the OAuth app is in testing. The account
   owner handles consent, verification and any provider-imposed approval.
5. Sign in to Tradie AI → Connections → Google Calendar → Connect. This release
   uses the connected account’s primary calendar, not a calendar chooser.
6. Obtain approval for a harmless exact test event. Verify Accept creates it,
   Deny creates nothing, and repeating/resuming the same approved action does
   not duplicate it. No test event has been created during this build.

Scope: `https://www.googleapis.com/auth/calendar.events`. Busy times for the next
14 days are read without sending event descriptions to AI. No attendees or
notification emails are requested. Reconnection changes identity, invalidating
old proposals. In-app disconnect removes local credentials; provider-side access
can be revoked separately in [Google account connections](https://myaccount.google.com/connections).

## 4. Facebook Pages

1. In [Meta for Developers](https://developers.facebook.com/apps/), create/select
   the intended business application and configure Facebook Login for Business.
   Use an official supported Graph API version shown by that app, not a guessed
   version. Set `META_GRAPH_VERSION` in `vN.N` form.
2. Configure the Business Login configuration with Page permissions
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` and the intended
   Page access. Set `META_LOGIN_CONFIG_ID` and `META_APP_ID` plus secret
   `META_APP_SECRET`.
3. Add the exact OAuth redirect:
   `https://tradie-ai-business-team.j-w-coleman87.chatgpt.site/api/integrations/facebook/callback`.
4. Complete Meta’s required app review/business verification for the intended
   external users. Permission eligibility/version details still require dashboard
   verification; successful unit tests are not Meta approval.
5. Keep `FACEBOOK_PUBLISHING_ENABLED=false`. Connect from Tradie AI; choose the
   exact Page from the expiring list. No Page is selected automatically. A Page
   token stays encrypted on the server and never appears in API responses.
6. Arrange a test Page and get explicit approval for the exact test post. Only
   then enable `FACEBOOK_PUBLISHING_ENABLED=true` in the intended environment.
7. Prepare a post, review exact text/link/Page ID and press **Publish to Facebook**.
   Verify the provider receipt and audit. A draft’s Accept button only saves it.

Supported: immediate text and optional HTTPS link. Not supported: photo/image
publishing, scheduling, Instagram, replies, messages, Facebook ads or deletion.
Photo requests are private drafts until image publishing is implemented; the
agent must not silently drop the photos and publish text instead.

### Uncertain Facebook publication

There is no assumed universal Facebook idempotency key. The database commits a
`sending` marker before the provider request. A confirmed post ID is saved as a
durable receipt. A structured explicit 4xx rejection can be retried. A timeout,
5xx, worker crash or malformed success blocks automatic reposting. The UI warns
that it may already have published and directs the owner to check the Page and
Ask James. Do not delete the marker or mark it rejected just to unblock retry.
Manual verified receipt reconciliation is an operator task; a self-service
reconciliation screen is not implemented.

## 5. Google Ads — read-only first release

1. Enable Google Ads API in the intended [Google Cloud project](https://console.cloud.google.com/).
2. Obtain a developer token through the manager account’s
   [Google Ads API Center](https://ads.google.com/). Confirm whether its access
   level permits test or production accounts. Set secret `GOOGLE_ADS_DEVELOPER_TOKEN`.
3. Google Ads can reuse the Calendar OAuth client, but needs this additional
   redirect exactly:
   `https://tradie-ai-business-team.j-w-coleman87.chatgpt.site/api/integrations/google_ads/callback`.
   Optional separate credentials: `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`.
4. Consent scope is `https://www.googleapis.com/auth/adwords`. Although Google’s
   scope permits broad access, this server exposes only fixed read queries. The
   selected account must be an advertiser, not a manager. Manager hierarchy
   access retains the validated `login-customer-id` where needed.
5. Set `GOOGLE_ADS_API_VERSION=v25` or another version after compatibility review.
   Connect, explicitly choose the advertiser account, then Load campaign report.
6. Verify account, currency, time zone, dates and figures against Google Ads.
   Missing conversions display “Not reported”, not an invented zero. Large
   integer metrics are retained as strings. Results are capped at 100 campaigns.

Reports cover `LAST_30_DAYS` and are not automatically sent to AI. There are no
campaign creation, targeting, pausing, budget or ad-spend endpoints. Building
these later requires new proposal schemas, exact-budget approval and tests;
never replace the read-only query endpoint with arbitrary model-generated GAQL
or mutation operations.

## Security and release checklist

- Run type check, lint, all tests, build, dependency audit and read-only setup check.
- Apply migrations before this release; verify RLS and browser grant denial.
- Configure hosted secrets separately from local `.env`, then deploy privately.
- Verify with two unrelated staging users and provider test resources.
- Rotate the Supabase service key exposed earlier in chat before customer data.
  Coordinate local and hosted updates, redeploy and verify; it has not been rotated.
- Preserve `TOKEN_ENCRYPTION_KEY`; rotate only with a deliberate re-encryption
  or reconnect plan. Never print stored provider tokens.
- Configure production SMTP, privacy/retention policy, backups, monitoring and
  OAuth/app verification before onboarding customers.
- Expired encrypted OAuth candidates are inaccessible but not auto-purged yet.
  Establish retention and an authorised cleanup job before production scale.

## Primary references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI errors](https://developers.openai.com/api/docs/guides/error-codes)
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude errors](https://platform.claude.com/docs/en/api/errors)
- [Claude models](https://platform.claude.com/docs/en/models/overview)
- [Google OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Calendar event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Google Ads REST authentication](https://developers.google.com/google-ads/api/rest/auth)
- [Google Ads account discovery](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts)
- [Google Ads developer token](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
