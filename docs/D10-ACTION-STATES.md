# D10 — Action states

Priority: approved work that does not start, together with missing outcome feedback. Finance coverage is a correctness requirement.

This adds to the existing set-out sheet. The navy/yellow identity, type scale, spacing and narrow Crew rail stay in place. Website's card now says **Draft changes for your website**.

[Open the drawn state sheet](d10-action-states.html). It is generated from the actual application components with synthetic records; rebuild it with `node scripts/render-action-states.mjs` after changing state styling.

| Evidence | Chip | Customer action / evidence |
| --- | --- | --- |
| Waiting approval, within expiry | Amber · Waiting on you | Approve / Not yet. Not yet leaves approval pending; Decline proposal is separate. |
| Approved, execution not started | Amber · Approved, not started | Resume; show saved approval time. |
| Executing, current lease | Amber · Sending / In progress | Explain that confirmation is pending. |
| Execution stopped without confirmed outcome | Amber · Needs checking | Resume when permitted; reconcile the original attempt. |
| Completed | Green · Sent / Booked / Saved | Database completion time; validated live post or Calendar receipt link. Private saves remain labelled private. |
| Definite failure | Red · Didn't send / Didn't save | Safe reason from the recorded error; Try again when permitted. |
| Calendar attempt failed without a successful receipt | Amber · Booking not confirmed | Recorded reason; Resume checks the same booking. A failed retry does not establish that an earlier booking failed. |
| Facebook sending/uncertain marker without live execution | Amber · Check Facebook | Explain possible publication. No retry or replacement that might duplicate the post. |
| Facebook confirmed publication but local completion failed | Amber · Sent, needs review | Publication timestamp and live post link. No retry or replacement. |
| Retry limit reached | Amber or red, according to evidence | Explain that review is required; no unusable retry control. |
| Denied / expired / replaced / cancelled | Neutral · Not approved / Expired / Replaced / Closed | History, without execution controls. |
| Finance evidence does not cover a verified complete period | Amber disclosure in the answer | Actual returned/total relevant record count, shortened-content count and explicit subtotal/partial-period limitation. |

Chips remain visible when cards are folded. Approved and failed cards open on status change. Recent completions appear in Workspace as well as History. Returning to the app refreshes states; active work is polled while the workspace is open.

## Data and execution contract

- Existing action rows supply status, approval time, completion time, lease and attempts. Internal execution tokens and actor IDs are not returned to the UI.
- Approval starts execution in the same server request. The Next route registers that same promise with `after` to keep it alive through browser disconnects, bounded by the host's maximum duration. It does not start a duplicate execution.
- A process failure can still leave approved or interrupted work. That saved state remains visible with Resume. There is no newly configured scheduler or guarantee of unattended recovery after host termination.
- Outstanding approved/executing/failed work, waiting proposals and recent history have separate query budgets. Expired waiting proposals count as history. Coverage counts disclose omitted rows.
- Chat receives conversation-scoped action outcomes and safe receipt links, plus confirmed onboarding profile data.
- Durable Facebook confirmation takes precedence over stale uncertainty errors. Closing a card preserves publication evidence and receipt links in History and Chat.
- Finance receives record-count and truncation metadata. The query still selects newest relevant saved records, not a transaction-date ledger. The server adds a disclosure to every Finance answer; even 15 of 15 saved records does not prove complete books for a month.

## Codex implementation block

```text
Implement D10 data and visual states together using existing Action rows.
Do not infer publication from approval or from an expired execution lease.
Use shared actionState / ActionStatusChip / ActionOutcome components so
Workspace, History and Chat use the same state meanings. Preserve owner
approval, connection binding, idempotent Calendar IDs, execution leases and
the durable Facebook sending marker. Not yet must not mean Deny.
Never display a financial period total from an undisclosed record sample.
Run the deterministic action, coverage and crew evaluation tests on every
change. Run synthetic live crew cases separately and report their result
as live evidence only when those real-provider calls have actually passed.
```

## Verification commands

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

`npm run eval:crew` runs the deterministic task rubrics and context checks. They use fixture answers and prove the checks, not live model competence.

The same seven representative tasks run against a real provider with `WORKBENCH_LIVE_CREW_EVAL=1` and `npm run eval:crew:live`. Set `WORKBENCH_EVAL_PROVIDER=anthropic` to select Claude; the default is OpenAI. Supply the chosen provider's key privately. These calls use synthetic business information and never invoke approval or execution endpoints. They can incur normal model usage charges. The live suite stays disabled in routine CI.

The approach follows the distinction between output schema validation and task evaluation in the [OpenAI structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [evaluation guide](https://developers.openai.com/api/docs/guides/evals). The host-lifetime hook follows the installed Next.js `after` documentation.

## Local verification — 5 September 2026

All 332 tests across 30 files passed, including API approval/execution, persisted outcomes, receipt recovery, tenant/conversation scoping, Finance coverage, rendered state components and the deterministic crew rubrics. Lint, TypeScript checks and the production build passed. The drawn sheet was regenerated from application components.

The live crew suite was invoked without its opt-in flag and reported eight skipped checks; no provider credentials are configured in this checkout. These results do not establish live model quality or live Facebook/Calendar delivery. Browser and device interaction have not been manually verified. This work has not been deployed.
