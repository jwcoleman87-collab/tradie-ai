# Workbench presentation repair — 5 September 2026

Based on the owner's [Claude presentation audit, revision A](https://claude.ai/code/artifact/36d118b0-0cff-4c9d-bdb9-8427ef261078), followed by the request to recover space for Chat. The owner also requested desktop and phone browser checks.

## Result

- Shared spacing, type, radius, control and logo measurements in `app/globals.css`. The existing navy/amber palette and supplied artwork are preserved. Body text stays at 16px and regular controls at 14px, using rem-based type so browser text preferences still work.
- One 24px desktop / 16px phone inset for the Chat heading, toolbar, messages and composer. `app/setout.css`, imported after the legacy/public layers, owns these workspace refinements without changing public landing/onboarding styling.
- Workbench controls compose the installed Button and retain native select/checkbox semantics, with styled focus/disabled states and 48px touch controls. Keyboard selection, optgroups and label activation remain available.
- BrandMark contains wide and tall artwork inside fixed 24px/32px square slots. OpenAI and Claude retain visible names beside their marks. Initials cover businesses without a known logo.
- The header shows the saved workspace name, existing profile services/location and the actual signed-in account. Workspace names remain canonical after renaming. The existing tenant-filtered state query exposes only the profile's services/location; no database migration or new identity collection is required.
- Approval cards show the originating business and actual destination. Internal records are clearly described as private records.
- Chat bubbles share a width and radius family; user messages use a light amber tint. Attach is labelled, and the composer has one status/reassurance caption. Loading uses reduced-motion-aware skeletons; an empty conversation has useful starter actions.
- Settings replaces More. Connections, Support, History and Audit use the full workspace with their own navigation. Feedback remains visible in Settings, and archived conversations reopen in Chat. Drafts survive opening/closing Settings and Focus Chat.
- Crew starts as an 80px icon rail on desktop, with an accessible expand/collapse control. This returns 160px to Chat at the tested desktop size. Focus Chat hides both side panels until Show panels is selected. Mobile retains the existing Crew / Chat / Workspace navigation.

## Verification

- All 286 existing tests pass. The Worker runtime test required an unsandboxed rerun because esbuild could not traverse the restricted filesystem; that rerun passed.
- Typecheck, lint and production build pass.
- Browser checks use the actual Workspace component and final styles with isolated sample data. They do not sign in, publish, connect accounts or create real support cases.
- Desktop: 1,424px viewport, 984px Chat with an 80px Crew rail; Focus Chat expands to 1,424px and retains the draft. Matching user/assistant bubble widths, common Chat insets, full-width Settings, 32px provider slots and loaded contained artwork were verified.
- Phone/short viewport checks: 390×844, 390×420, 320×360 and 844×300 landscape. Send remains visible with a multiline draft, the input remains 16px, and no horizontal overflow was found. These are browser viewport checks, not physical iOS keyboard certification.
- Checked Settings navigation, visible simulated support errors, and History → Open read-only returning to a disabled archived conversation.

## Delivery boundary

The active application remains the native Vercel project. The `.openai/hosting.json` registration is historical; its retired redirect deployment must not be replaced with this app.

Published on 5 September 2026 to [the live Workbench workspace](https://tradie-ai-efuf.vercel.app/workspace). The deployed source is commit `775b95db37f13fc17cf6a916427c9d49dc659608`, backed up on GitHub as `codex/ui-setout-2026-09-05` after the owner's explicit approval. Deployment `dpl_bqnz9bFPqQzbz2EBc8d6qQBD1xFZ` was built from an isolated checkout of that commit, keeping concurrent work in the shared checkout out of the release. Vercel confirmed that the canonical production URL points to this deployment.

Production checks: the workspace responds with HTTP 200 and the new controls; health reports `configured`; unauthenticated private state remains HTTP 401. The existing signed-in session loads its saved business details and conversation. Focus Chat fills the 1,424px desktop viewport and Settings uses the full workspace. At 390×844, the document width is 390px, the composer uses 16px text, and the 48px Send control remains visible within the viewport. These checks did not send a chat message or change business data. The broader isolated browser checks and code checks are recorded above.

Customer wallpaper and new logo-upload/profile fields are not added. The owner's request to reclaim valuable space is addressed with the narrow Crew rail and Focus Chat, using the identity data already available.

## Follow-up: brand mention finish

Published the owner's requested correction on 5 September 2026 as commit `f6d3fbe`, deployment `dpl_HovZrsThAxj92RVHq8g6eDwsokVU`, to the same live Workbench URL. GreenVac mentions use the supplied artwork's exact `#1B7045` green and a clear white name, removing the tiny raster thumbnail with its baked-in frame. Facebook mentions use `#0866FF`, white lettering and the existing Facebook mark clipped to remove its JPEG's white canvas. Mention wrappers and nested logo slots have no borders or shadows. The change is scoped to brand mentions in `app/setout.css`.

Verified the actual Workspace component on both message backgrounds at desktop and 390×844 phone sizes; all checked badges have zero-width borders and 14px names, with no horizontal overflow and Send remaining visible. Vercel's isolated production build passed, publication succeeded, and the signed-in live conversation shows both corrected badges with the expected colours and no outlines. The exact correction was backed up to the existing GitHub release branch after explicit owner approval. Concurrent work in the shared checkout was preserved and excluded from this deployment.

## Follow-up: designed draft previews

Published the requested proposal-card redesign on 5 September 2026 as commit `5dbe189`, deployment `dpl_4mwT3xmJ7iahccvkDWhYjfCuoUJK`, to the same live URL. Private drafts and records now have a distinct preview header, readable 16px body text, attachment figure, expandable review notes, and a green private-save panel. Recognized Caption / Image / Notes layouts are presented as separate sections; the complete original draft remains available. Ambiguous or unstructured bodies remain intact. Existing payloads, approval controls and execution handlers are unchanged.

An image mentioned in a draft's explicit image-reference section is previewed only when its exact ID matches an existing ready JPEG, PNG or WebP in the current upload snapshot. No unknown-ID URL is fetched and no image is substituted. Existing authenticated, expiring image previews are reused. Five focused presentation tests passed, the new files passed lint, and the isolated production build succeeded. Desktop and 390×844 phone checks covered layout, image loading, notes and original-text disclosures; no horizontal overflow was found. The live GreenVac draft displayed its actual attached artwork and preserved caption, with health reporting configured. No draft was accepted, denied or published during these checks. Concurrent shared-checkout changes were preserved and excluded from the release.
