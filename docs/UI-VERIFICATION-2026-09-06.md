# Workbench UI verification — 6 September 2026

Work was performed in the existing `tradie-ai` checkout for `jwcoleman87-collab/tradie-ai`, on `codex/ui-setout-2026-09-05` at base commit `775b95d`, preserving its existing uncommitted work. The remote refs and the existing release worktree were checked. The user confirmed that the requested composer, activity and filter designs existed only in an external prototype, and authorized their implementation after baseline verification.

## Baseline

| Command             | Result                                   |
| ------------------- | ---------------------------------------- |
| `npm run format`    | Passed                                   |
| `npm run typecheck` | Passed                                   |
| `npm test`          | 32 files, 349 tests passed               |
| `npm run build`     | Passed; all six application routes built |

The first sandboxed test attempt passed 348 tests but failed the existing Workers runtime test because esbuild could not read a parent directory. The first sandboxed build could not download the configured Google Fonts. Both unchanged commands passed with the required filesystem/network access. No test was skipped and no TypeScript error was suppressed.

The repository had a text-only composer, selectable crew cards and a workspace-wide To do view. It did not contain the prototype's voice controls, cluster/ribbon or Needs you / All / Done filters. The existing action-history link selected a nonexistent view. Short mobile keyboard layouts could leave no readable message area, and reduced-motion settings did not disable all hover transitions.

## Implementation and architecture

- Voice is a draft editor. Empty supported composers show a microphone; typed text shows Send. An active or finalizing voice session shows Cancel/Keep and blocks submission, including Enter. Cancel restores the exact original draft. Keep waits for final recognition and returns editable text without sending. Recognition errors, late callbacks, navigation, scope changes and cleanup are handled. Unsupported browsers show the ordinary text composer without a microphone.
- The activity ribbon uses existing chat progress. Individual agents are marked working only for an executing action with a live lease and no uncertain/confirmed publication requiring review. Selected specialists and previous contributors are not presented as currently working. The backend does not expose live per-specialist chat progress, so the UI does not invent it.
- Needs you contains unapproved proposals and actions requiring intervention. All contains every loaded action, including active execution. Done contains completed, denied, expired, cancelled and superseded actions, including locally expired waiting proposals. Counts match loaded rows. Existing server coverage limits are disclosed rather than presented as complete totals. Deadline-driven updates move expired proposals and stopped execution into the right views.
- Done and action-history rows render outcome/status information without approval, retry or replacement controls. Opening an archived conversation disables changes through the workspace action cards. Existing owner, expiry, connection, immutable-approval and server execution guards remain.
- The existing viewport and scroll helpers are retained. Compact keyboard layouts reduce padding and composer height; very short landscape layouts put messages beside the composer. Reduced-motion settings stop workspace animations and transitions while preserving static status indications.
- Cancel/replace action responses now use the existing `publicAction` serializer, preventing internal execution-token and approving-actor metadata from being returned. The RPCs and authorization flow are unchanged.

## Files changed by this task

| File                                 | Change                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/workspace.tsx`           | Composer integration; activity cluster/ribbon; filters/counts/deadline updates; history-link repair; archived-conversation action guard; dictation cleanup on navigation and starter selection. |
| `app/workspace.css`                  | Activity, voice and filter styling; compact portrait/landscape keyboard layouts; reduced-motion overrides.                                                                                      |
| `lib/voice-draft.ts`                 | Browser recognition adapter and isolated draft session lifecycle.                                                                                                                               |
| `lib/use-voice-draft.ts`             | React support detection, scoped cleanup and composer integration.                                                                                                                               |
| `lib/workspace-ui.ts`                | Shared terminal/attention/running classifications and evidence-based agent activity.                                                                                                            |
| `lib/server/actions.ts`              | Public serialization for cancel and replacement responses.                                                                                                                                      |
| `tests/voice-draft.test.ts`          | 18 recognition/draft regression cases.                                                                                                                                                          |
| `tests/workspace-ui.test.ts`         | 20 action-filter, deadline and activity regression cases.                                                                                                                                       |
| `tests/action-execution.test.ts`     | Two cancel/replace response-metadata regression cases.                                                                                                                                          |
| `docs/UI-VERIFICATION-2026-09-06.md` | This verification record.                                                                                                                                                                       |

Unrelated formatter-only changes were restored to their initial contents, including onboarding files. Existing uncommitted files were backed up before formatting. No onboarding work, dependency change, commit, push or deployment was performed.

## Final validation

All four requested commands passed on the completed source: format, TypeScript, 389 tests across 34 files, and the production build. `git diff --check` also passed. The test suite grew by 40 tests; no tests were removed or bypassed. The existing backend, chat, approval, connector, database-isolation and action-lifecycle tests remain green.

Browser checks used Chromium at widths 320, 375, 390, 540, 768, 900, 901, 1024, 1025 and 1440 pixels. All 78 short/multiline composer geometry cases passed, including simulated keyboard heights down to 300 pixels in portrait and 200 pixels in landscape. Send remained visible, controls did not collide, agent icons stayed within their header, the page did not overflow horizontally, and the message viewport retained at least one readable line. Safari-style viewport panning and preserving an older reading position were also simulated successfully.

Supported voice, unsupported voice and typed Send were checked in the browser. Cancel restored whitespace drafts exactly; Keep and natural recognition end retained editable text; Enter while listening produced no chat request. A typed Send used the existing chat transport and confirmed-receipt flow, cleared the composer and displayed the returned reply. Reduced-motion checks reported no agent/action transition and no activity animation.

At 375, 900 and 1440 pixels, the mixed-action fixture showed Needs you 3 / All 8 / Done 4, with exactly 3 / 8 / 4 matching rows. Terminal cards and action-history rows contained zero action controls. An archived conversation had zero enabled approval controls. Only the agent with live executing work was marked working; the approved-but-not-started agent was not. A live expiry check moved the unapproved proposal to Done, removed its approval button and stopped the expired execution's activity indicator without requiring a refresh.

Browser evidence and the reproducible local fixture are in `work/ui-verification/`; these synthetic QA assets remain ignored by Git and excluded from the production build.

Four-attachment layouts also passed at 320×300, 375×360, 540×200 and 900×200, retaining 27, 103, 46 and 62 pixels of readable message content respectively. Voice with four attachments passed at 320×300 and 540×200. Attachment strips scroll, and Send/Cancel/Keep stay within the viewport without overlapping the toolbar. The final combined browser results contain no failures. The reduced-motion rule for portalled image dialogs was verified in source; the other reported reduced-motion checks were exercised in Chromium.

## Validation limits

Browser verification uses the real Workspace component, CSS and chat transport with synthetic local data, mocked SpeechRecognition and VisualViewport events. It does not use customer accounts or external publishing services. Automated keyboard/scroll simulation does not replace physical iOS Safari/Android keyboard testing. Actual microphone permissions and transcription quality still require a device check. Existing backend tests use mocks and PGlite; no live provider or production database verification was performed.
