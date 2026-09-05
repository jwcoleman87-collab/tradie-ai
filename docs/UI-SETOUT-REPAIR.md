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

The active application remains the native Vercel project. The `.openai/hosting.json` registration is historical; its retired redirect deployment must not be replaced with this app. This repair is local and has not yet been published to the live Vercel URL.

Customer wallpaper and new logo-upload/profile fields are not added. The owner's request to reclaim valuable space is addressed with the narrow Crew rail and Focus Chat, using the identity data already available.
