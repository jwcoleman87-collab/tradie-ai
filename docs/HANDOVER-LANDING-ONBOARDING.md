# WORKBENCH — landing page and intelligent onboarding handover

**Prepared:** 2 September 2026 (Australia/Sydney)  
**Owner:** James Coleman  
**Status:** Authoritative brief for the next Codex implementation chat  
**Immediate assignment:** Begin building the public landing surface and the intelligent, conversational onboarding flow described below.

## 1. Read this first

Continue the existing WORKBENCH product. Do not restart, replace or re-scaffold it.

The live production application is:

- Stable Vercel URL: <https://tradie-ai-nine.vercel.app/>
- GitHub: <https://github.com/jwcoleman87-collab/tradie-ai> (private)
- Supabase project reference: `gjrhukwqagaawdklnvxd` (Singapore)
- Current working branch: `codex/google-ads-production-access-doc`
- Current release commit at handover: `ba3b88d` (`Add persistent collapsible workspace actions`)
- Production source directory:
  `C:\Users\James Coleman\Documents\Codex\2026-08-31\referenced-chatgpt-conversation-this-is-an\outputs\tradie-ai`

The older OpenAI Sites URL and the legacy `tradie-ai` names in cloud resources are historical identifiers. The Vercel/Next.js repository above is the active production source. Do not move new work back into the Sites prototype.

Before editing, read the repository `AGENTS.md`, the relevant Next.js 16 documentation under `node_modules/next/dist/docs`, and the files in the source map below. Check `git status` and preserve unrelated owner work.

## 2. Product in plain language

WORKBENCH is an AI crew for Australian trades and small service businesses. It helps the owner run the business work behind the physical work.

The product language is:

1. **Crew** — Finance, Marketing, Social, Maintenance and Website specialists.
2. **Magic Chat** — the simple conversational front door. The owner tells Magic what needs doing and the right crew members are routed behind the scenes.
3. **Workspace** — private files, records, connections, approvals, receipts, audit and work still needing the owner's attention.

The trust model is fundamental:

- AI may prepare work.
- External changes require a clear owner approval.
- Accept and Deny must remain meaningful.
- Failed actions remain honest and visible.
- Workspace connections and data remain isolated per business.
- Confirmed external actions receive provider receipts.
- The assistant must not claim it found, connected, sent, booked or published something without evidence.

## 3. Non-negotiable owner direction

### The current aesthetic is locked

James explicitly loves the current WORKBENCH aesthetic. Do not change the logo, colours, typography, visual language, icon style, navigation treatment, overall layout character or brand tone unless James explicitly asks for an aesthetic change.

New landing and onboarding screens must extend the existing system:

- WORKBENCH joined-owner-and-crew mark
- Workshop ink/navy, yellow, white and steel greys
- Work Sans headings
- Inter body copy
- Straightforward, capable, supportive trade-business tone

The source of truth is:

- `docs/brand/workbench-styleboard.png`
- `docs/brand/README.md`
- `public/workbench/mark.png`
- `public/workbench/lockup.png`
- `public/og.png`
- `app/globals.css`
- `app/workbench.css`

Do not reintroduce the old blue tile mark or purple/lilac Tradie AI theme.

### Other scope constraints

- Legal/compliance implementation was consciously deferred by James. Do not let it block this build. Keep public indexing and unrestricted public onboarding conservative until legal pages are approved.
- Do not invent pricing, customer counts, savings figures, testimonials, platform approvals or commercial claims.
- Do not change existing connections, send messages, create bookings, publish posts or spend advertising money during this work.
- Do not expose, print or commit `.env` values, API keys, OAuth tokens or Supabase server credentials.
- Keep the existing workspace working while the new routes are introduced.

## 4. Source map — where to look

| Purpose                                                     | Source                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Current root route                                          | `app/page.tsx`                                                                |
| Global metadata/fonts/styles                                | `app/layout.tsx`, `app/globals.css`, `app/workspace.css`, `app/workbench.css` |
| Main authenticated product and current sign-in/bootstrap UI | `components/workspace.tsx`                                                    |
| Same-origin API entry                                       | `app/api/[...path]/route.ts`                                                  |
| API orchestration                                           | `lib/server/api.ts`                                                           |
| Authenticated browser client                                | `lib/client.ts`                                                               |
| Shared runtime contracts                                    | `lib/contracts.ts`                                                            |
| AI routing/generation                                       | `lib/server/ai.ts`, `lib/server/ai-provider.ts`, `lib/server/model-schema.ts` |
| Managed crew instructions                                   | `skills/*/SKILL.md`, loaded by `lib/server/skills.ts`                         |
| Database/RLS/RPC history                                    | `supabase/migrations/*.sql`                                                   |
| Current architecture                                        | `docs/ARCHITECTURE.md`                                                        |
| Connections and provider boundaries                         | `docs/CONNECTIONS.md`                                                         |
| Workspace archive/governance                                | `docs/WORKSPACE-GOVERNANCE.md`                                                |
| Troubleshooting and audit behaviour                         | `docs/CHAT-TROUBLESHOOTING.md`, `docs/VERIFICATION.md`                        |
| Historical continuation notes                               | `docs/CONTINUATION.md`                                                        |
| Tests                                                       | `tests/*.test.ts`; run `npm run check`                                        |

Some older verification paragraphs describe what had not yet been tested at that earlier checkpoint. Treat dated notes as history when later provider receipts or this handover contradict them.

## 5. Current product and operational state

- Next.js 16.3.4 App Router, React 19.2, TypeScript, Vercel and Supabase.
- Supabase Auth, Postgres, private Storage, RLS and server-only write RPCs.
- Persistent conversations, private file previews, business records and multi-workspace separation.
- Owner-gated Proposed Actions with Accept/Deny, execution failure states, retries and append-only audit receipts.
- OpenAI and Anthropic provider support with owner consent and optional fallback.
- Google Calendar connected and a completed calendar action exists.
- Facebook connection completed a real image post with a confirmed Meta receipt. There was also an earlier, separate `PUBLISHING_DISABLED` failure. Do not repeat the incorrect audit claim that zero posts ever published or that one action was simultaneously failed and completed.
- Google Ads is designed as read-only reporting first. The Basic Access application was submitted and production advertiser access was still pending at the last recorded provider checkpoint.
- The right-hand To-do tiles now default collapsed and remember each user's open/minimised state in that browser.
- The conversation and composer widths were recently normalised.
- At handover, `npm run check` passed 137 tests and the production build.

## 6. Immediate build objective

Create an industry-standard landing and first-run onboarding experience that explains WORKBENCH quickly and begins learning a new customer's business through Magic.

This must not be a conventional multi-page form, and it must not be a form disguised as a chatbot.

The core product principle is:

> **Magic asks a small number of high-information questions to locate reliable evidence. It then researches and completes the business profile itself, shows what it found and where it came from, and only asks the owner about genuine gaps or conflicts.**

The owner should feel that WORKBENCH is doing the onboarding work with them, not transferring admin work into a chat window.

## 7. Recommended route structure

Introduce clear route boundaries without breaking the existing app:

- `/` — public WORKBENCH landing page.
- `/sign-in` — sign-in, account confirmation, password recovery and controlled account creation.
- `/onboarding` — authenticated first-run Magic business discovery.
- `/workspace` — the existing three-panel WORKBENCH product.

The current `/` directly renders `components/workspace.tsx`, and auth/bootstrap is embedded inside that large client component. Extract deliberately; do not duplicate authentication logic across pages.

Important routing work:

- Existing authenticated owners should be able to reach `/workspace` without being forced through onboarding again.
- New confirmed users with no workspace/profile should enter `/onboarding`.
- A completed onboarding should continue to `/workspace`.
- Password recovery and email confirmation redirects currently use `window.location.origin`; update and test intended destination paths carefully.
- OAuth API callback routes under `/api` must remain unchanged unless provider configuration is deliberately updated.
- Keep `robots.index` false until James approves public indexing and the required public/legal surfaces are ready.

If a safer incremental route plan is required, first ship `/` plus `/workspace` while preserving the existing auth flow, then extract sign-in/onboarding in the next slice. Do not leave production unable to sign in.

## 8. Landing page requirements

The landing page should make the outcome clear in under 60 seconds using the locked aesthetic.

### Required content

- WORKBENCH lockup and the approved line: **Your business. Your crew. One place.**
- Outcome-led hero based on the approved brand idea: **You build it. We handle the business.**
- A plain explanation of Magic: tell it what needs doing; the right crew handles the business work; the owner stays in control.
- Three-step explanation: **Talk to Magic → Your crew prepares the work → You review the result.**
- A concise view of the crew framed as outcomes, not AI personas.
- Trust section covering private workspaces, approval before external change and clear receipts. Do not make unverified absolute security claims.
- A preview of intelligent onboarding: five simple prompts can become a sourced business profile instead of a long setup form.
- Primary CTA for controlled onboarding/pilot entry and a clear **Sign in** path for existing owners.
- Responsive desktop and phone layouts.
- Useful metadata and social preview using the existing brand assets.

### Do not invent

- A final price or plan structure.
- Testimonials or customer logos that have not been approved for marketing.
- A fake interactive demo or fake connection status.
- Claims that every crew capability is already a completed external integration.

Use honest language such as a controlled pilot where a commercial decision is still open.

## 9. Intelligent onboarding behaviour

### Conversation design

Target no more than five high-information owner prompts before presenting a useful first business profile. The prompts must be adaptive, not a hard-coded interrogation where every customer sees every field.

An effective opening can group related information naturally, for example:

> “What is the business called, where are you based, and what sort of work keeps you busiest? If you know your website or business profile, include it—but you do not have to go looking for it.”

From that answer, Magic should decide what evidence to look for. Subsequent prompts should cover only information that materially changes the search or recommended setup, such as:

1. The business identity and location/service-area anchor.
2. The work the owner wants more of—not a complete service catalogue.
3. Where enquiries and admin currently arrive or are managed.
4. The single biggest business/admin bottleneck to solve first.
5. Confirmation/correction of the sourced profile and the first recommended outcome.

These are information goals, not five mandatory chat messages. Magic may combine goals, skip what is already known, or ask one focused clarification when sources conflict.

### What Magic should do itself

Using owner-approved and legitimately accessible sources, Magic should try to locate and extract:

- Trading and legal identity, where reliably available.
- Website and public business profiles.
- Public contact details and operating/service area.
- Services, common job types and customer segments supported by evidence.
- Public opening hours.
- Existing brand name, logo, imagery and writing tone.
- Connected tools or owner-supplied files that can safely answer setup questions.
- Obvious missing or contradictory information.

Potential evidence sources include an official website, Google Business Profile, ABN/official registry information, public social pages, connected services and documents the owner deliberately supplies. Research current official APIs and terms before implementing any provider. Do not scrape behind authentication, evade access controls or treat search snippets as authoritative records.

The current assistant has no general web-research connector. Add a server-side discovery boundary rather than pretending research occurred. If the first release cannot yet query a real source, show that limitation honestly and implement the workflow so a verified adapter can be connected without rewriting onboarding.

### Evidence and confidence

Every populated profile fact should carry:

- Value.
- Source URL or internal source reference.
- Source label.
- Confidence: high, medium or low.
- State: discovered, owner-supplied, inferred, confirmed or needs confirmation.
- Last checked time.

The review screen should say **What Magic found** and make corrections easy. Ask the owner only about low-confidence, conflicting or high-impact facts.

Never silently infer or publish private financial information, pricing, licences, insurance, staff identities, legal status or safety-critical capabilities.

## 10. Proposed onboarding state model

Do not force the existing free-text `business_records` table to become the whole onboarding model. Add a deliberate, tenant-isolated schema after reviewing current migrations and RLS patterns.

Suggested objects:

### `business_profiles`

- `workspace_id`
- `display_name`
- `legal_name`
- `abn` or applicable official identifier
- `website_url`
- `phone`, `email`
- `base_location`
- `service_areas`
- `services`
- `preferred_job_types`
- `customer_types`
- `business_hours`
- `brand_summary`
- `primary_goal`
- `admin_bottleneck`
- `onboarding_status`
- `confirmed_at`
- timestamps

### `business_profile_facts`

- `workspace_id`
- `field_path`
- `value` as validated JSON
- `source_type`
- `source_label`
- `source_url` or private source reference
- `confidence`
- `fact_state`
- `observed_at`
- `confirmed_at`

### `onboarding_sessions`

- `user_id`, optional `workspace_id`
- conversation/transcript state
- information goals covered
- unresolved questions
- discovery status
- resumable progress
- completion timestamp

Apply RLS to every new customer table, keep privileged writes server-side and add tests proving tenant A cannot read or mutate tenant B.

Do not store chain-of-thought. Store concise conclusions, sources, confidence, structured profile facts and safe operational traces.

## 11. AI and discovery architecture

Use one persistent Magic onboarding assistant rather than the normal five-agent
routing loop. Magic receives the saved setup conversation on every turn, answers
the owner's question first, and gradually builds the profile without following a
fixed questionnaire or stopping after five answers.

Suggested server flow:

1. Validate the authenticated onboarding request.
2. Load the current profile, evidence and goals already covered.
3. Ask the model for a structured `OnboardingTurn` containing:
   - concise reply,
   - extracted owner facts,
   - discovery queries/source plan,
   - remaining information goals,
   - whether profile review is ready.
4. Run allowed discovery adapters server-side with strict timeouts and allow-lists.
5. Normalise evidence into sourced profile facts.
6. Answer the owner's immediate question, then ask one follow-up only when it is
   useful; otherwise present the draft profile while keeping the conversation open.
7. Require owner confirmation before the profile is treated as confirmed.

Do not use five model calls for five crew personas. Optimise for a quick first useful result and stream visible progress where supported.

All model output must remain schema-validated. Keep raw third-party page content out of logs and protect against instructions embedded in fetched pages.

## 12. First vertical slice to ship

The next Codex chat should begin implementation, not just write another plan. A sensible first vertical slice is:

1. Extract the current app to a stable `/workspace` route without changing its appearance or behaviour.
2. Build the locked-brand `/` landing page and working navigation to sign-in/onboarding.
3. Introduce an authenticated `/onboarding` shell using Magic's visual language.
4. Persist a resumable onboarding session and the owner's first high-information answer.
5. Produce a schema-validated draft business profile from owner-supplied information.
6. Show a **What Magic found** review with fact status and sources.
7. Add the real discovery-adapter boundary; do not fabricate public research if the provider is not connected in this slice.
8. Route confirmed onboarding into the existing workspace.

Keep the slice small enough to test fully. Do not combine landing, onboarding, billing, jobs, quoting, legal pages and every connector into one unsafe release.

## 13. Acceptance criteria

### Landing

- Signed-out `/` explains WORKBENCH clearly without exposing private workspace data.
- The design visibly belongs to the existing WORKBENCH product.
- Existing owners can reach sign-in and the workspace.
- Primary CTA reaches the controlled onboarding path.
- Desktop and phone layouts are coherent.

### Onboarding

- New onboarding starts conversationally, not with a long form.
- The first prompt gathers multiple useful anchors in plain language.
- The flow targets five or fewer high-information prompts before profile review.
- It skips questions already answered by reliable evidence.
- It resumes after refresh/sign-out without losing confirmed progress.
- Discovered, supplied and inferred facts are visibly distinguished.
- Every discovered fact has a source and confidence state.
- The owner can correct facts before confirmation.
- The system never claims research ran when it did not.
- Completion creates or updates only the authenticated owner's workspace/profile.

### Regression and security

- Existing WORKBENCH aesthetic is unchanged inside `/workspace`.
- Chat, files, action cards, archive, connections and existing approvals still work.
- No external action occurs during onboarding without a separate explicit approval.
- New tables and endpoints have validation, auth, RLS and cross-tenant tests.
- `npm run check` passes.
- Browser checks cover signed-out landing, sign-in routing, onboarding refresh/resume, profile confirmation and the existing workspace at desktop and phone widths.
- Deploy through the linked Vercel project, verify the stable alias and scan production error logs.

## 14. Known product decisions still open

Do not invent permanent answers to these without James:

- Final public pricing and billing model.
- Whether onboarding is open self-serve, invitation-only or a founding-customer pilot at first release.
- The production public-research provider(s) and acceptable operating cost.
- The first full money workflow after onboarding (current recommendation is Customer → Job → Quote → approved PDF/send).
- Final legal, privacy, security and public-indexing release.

These decisions should not prevent the first route/UI/data vertical slice from being built safely behind the current controlled access.

## 15. Working and release discipline

- Work in the production repository named above.
- Preserve a clean Git history and do not overwrite unrelated changes.
- Use `apply_patch` for deliberate file edits.
- Read version-pinned Next.js docs required by `AGENTS.md` before modifying routes or layouts.
- Run targeted tests during development and `npm run check` before release.
- Visually verify the real UI; a passing build does not prove onboarding works.
- Commit and push the scoped change.
- Deploy to the linked Vercel project only after checks pass.
- Confirm the deployment is `Ready`, the stable alias is correct and recent runtime error logs are clean.
- Update this handover or `docs/CONTINUATION.md` with the shipped route/data decisions and test evidence.

## 16. Copy-ready opening instruction for the next Codex chat

> Continue the existing WORKBENCH application from `C:\Users\James Coleman\Documents\Codex\2026-08-31\referenced-chatgpt-conversation-this-is-an\outputs\tradie-ai`. Read `AGENTS.md` and `docs/HANDOVER-LANDING-ONBOARDING.md` completely before acting. Begin implementing the first vertical slice in section 12; do not stop after planning. The current WORKBENCH aesthetic is locked and must not change unless James explicitly asks. Preserve the existing authenticated workspace and its trust/approval architecture. Build onboarding as an intelligent business-discovery conversation: Magic asks no more than roughly five high-information prompts, uses reliable approved sources to answer the remaining profile questions itself, shows sources/confidence, and only asks the owner about genuine gaps or conflicts. Never fabricate research, customer facts, connections or external outcomes. Run the full checks, verify the UI and deploy the completed safe slice to the linked Vercel production project.
