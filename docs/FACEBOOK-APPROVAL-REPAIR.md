# Facebook approval and publishing repair — 6 September 2026

## Observed production issue

GreenVac Page `425519427313504` is connected and passed its read-only check. Vercel project `tradie-ai` has `FACEBOOK_PUBLISHING_ENABLED=false` for Production and Preview. The connection card said “Connected and ready” and attributed missing publishing capability to Meta approval, although that branch only checked Workbench's own switch. The chat substituted `draft.save` for a publication proposal, so its generic Approve button saved another private draft.

Production code baseline: `24aefcc8` on `main`. This repair is isolated on `codex/facebook-approval-execution-20260906` and does not include other local UI/onboarding work.

## Resulting behavior

- Facebook post requests produce exact `facebook.publish` proposals for the trusted selected Page, unless the owner explicitly requests a private draft. A disabled operator switch still allows preparation; it never allows execution.
- Facebook review has **Edit** and **Approve**. Approve uses the existing single server decision request, which starts execution. The actual completion/receipt still determines whether a post was published.
- Blocked publishing is explained accurately; Approve is disabled. A stale approval request is rejected before recording approval when the operator switch is off.
- Edit changes only the caption and optional HTTPS link. Saving creates a new immutable, unapproved proposal; the old one is superseded atomically. The Page, connection, selected photo and original expiry remain bound. No approval or execution is reused. Exact edit retries return the same pending successor.
- Private saves use **Save draft** or **Save record**, so those buttons cannot be mistaken for publishing approval.
- Public `/privacy` and `/data-deletion` pages describe the implemented service and manual privacy request process. The owner authorized creating and using these pages for Meta. Both use the workspace owner's contact, `james@greenvac.com.au`, and are linked from the home page.

## Release order and outstanding live setup

1. Applied `supabase/migrations/202609060001_revise_facebook_action.sql` to the production Supabase project `gjrhukwqagaawdklnvxd` before deploying the UI/API. The migration and history registration ran in one transaction. Verified the function exists and grants execution to `service_role`, with execution denied for `anon` and `authenticated`. It adds one owner-checked function; it does not modify existing posts or approvals.
2. Deploy the reviewed repair commit. Keep the current publishing switch off until live setup is ready.
3. Meta app `1143341441690414` is **Unpublished**. The initial live requirements page showed a missing **Privacy policy URL**, with the final Publish button disabled. After deploying, verify the public `/privacy` and `/data-deletion` URLs and save them in Meta's basic settings, as authorized by the owner.
4. Complete the applicable Meta go-live requirements with the owner's authorization, then enable publishing in the intended environment and redeploy. The current switch is app-wide, not specific to GreenVac; preview should remain disabled unless explicitly needed.
5. Review the exact customer post and destination in Workbench, then use Approve once. Verify the Meta receipt and public visibility before reporting it published. No live/test Facebook post was sent in this task.

Meta's [App Modes documentation](https://developers.facebook.com/documentation/development/build-and-test/app-modes) distinguishes development test data from public visibility. A working connection or a test creation does not establish that public posting is live.

## Verification

- Targeted approval/preparation tests cover operator-disabled preparation, invalid or different Pages, reconnect/error states, blocked stale approvals, denial and one-request execution.
- Database/API edit tests cover immutable successors, original expiry and image preservation, owner isolation, stale edits, duplicate edit retries, connection changes, expired actions, prior approvals and uncertain/confirmed publication attempts.
- Browser checked the actual React action card using temporary local callbacks: Edit hid approval; Save changes showed the revised exact text with zero approvals; one Approve invoked its callback once; the disabled-switch case disabled Approve and showed the operator reason. No application console errors were observed. The temporary route and fixture were removed after verification.
- The existing worker-runtime test requires execution outside this Windows sandbox. It passed there; the in-sandbox full run passed all other 447 tests.
- Type checking, lint, dependency audit (zero vulnerabilities), and the production webpack build passed. Webpack was used locally because dependencies are linked from the existing checkout; CI and deployment use the normal build.
- Both public policy pages were checked in a local production build without authentication. The privacy links, deletion instructions and rendered layout work.
