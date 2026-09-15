# On-demand failure diagnosis

Open a failed action, or go to Workspace settings > Audit and find a failed AI request. Choose **Diagnose this failure** to generate a short assessment from its recorded evidence. The panel shows the likely cause, AI confidence, next steps for the workspace owner or Workbench operator, missing evidence, a timestamped evidence snapshot, and reported token usage.

This is a read-only diagnostic path. Ordinary chats outside the Manager rollout do not receive additional context or incur diagnostic calls. In explicitly enabled owner/test workspaces, the [Manager runtime](MANAGER-RUNTIME.md) can invoke the same `diagnoseOperation` service through `diagnosis.run`; the owner does not need to ferry its report between screens. The existing provider preferences, consent and fallback rules apply. A request may use a backup provider if allowed; each attempt is capped at 2,500 output tokens and all attempts share a 55-second deadline. The existing durable rate limiter allows three diagnostic requests per user/workspace per minute, shared by both interfaces. These controls are not a dollar-spend cap.

## Evidence and boundaries

`POST /api/diagnosis` accepts only a workspace ID, target kind (`run` or `action`) and target ID. The server verifies membership, active workspace status and AI consent before loading the target with both ID and workspace filters. It never accepts diagnostic evidence from the browser.

For AI requests, the evidence contains saved error/status codes, timestamps and at most six provider attempts with stage, HTTP status, timing and output-limit metadata. Current stage budgets are explicitly labelled as configuration, not historical values.

For actions, it contains action type/status/error, timestamps, attempt count, saved publication state, execution-receipt presence and a small stored connection snapshot. Current Facebook publishing configuration is labelled as current. Stored checks are not new provider health checks. No credential decryption or external connection verification is performed.

Evidence is rebuilt field by field. Customer prompts, conversation text, action payloads, file contents, account names, access tokens, raw provider bodies and arbitrary log text are excluded. The model has no tools, and its strict result schema has no proposals or executable actions. Confirmed publication and uncertain external outcomes must be reconciled rather than blindly repeated.

The button result is displayed in the selected panel until it is unmounted or refreshed. It is not added to business records or Chat history. When Manager requests diagnosis, the result becomes evidence for its persisted Chat explanation. Metadata-only audit entries record target, request reference, model, status and token usage. If the model fails, both paths still return the evidence snapshot. Failed audit persistence is logged by reference only and does not discard the report.

## Validation

`tests/diagnosis.test.ts` covers membership denial, missing/cross-workspace targets, consent, archived workspaces, strict input validation, rate limiting, bounded sanitisation, publication-state preservation, provider failure, rejecting proposals and metadata-only writes. Existing chat and provider transport tests also run unchanged.

No database migration, new permissions or background automation is required. To remove the feature, revert its source commit and redeploy; the model configuration is independent.
