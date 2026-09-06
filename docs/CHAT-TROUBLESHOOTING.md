# Chat failure diagnosis

## September 5 connector and Chat repair

See [the repair and rollout report](CONNECTOR-CHAT-REPAIR.md) for the current
deadline, receipt, connection recovery and migration requirements. The sections
below retain the history of the August repair; its live verification statements
do not establish the September deployment status.

## August 31 hosted failure

The reported `AI_UNAVAILABLE` was not evidence of exhausted credits. Both
adapters used `redirect: 'error'`, accepted by Node fetch but rejected by the
installed Worker engine before an HTTP request. The same option also existed
in Facebook/Ads connection helpers. All use manual redirect handling now;
their non-2xx checks reject redirects without forwarding keys.

The regression bundles the real transport helper and executes it inside
Miniflare/workerd, reproducing the failure and verifying the fix. A real
synthetic OpenAI routing + generation test inside that engine completed (HTTP
200, validated private `draft.save` proposal). No database writes or actions
were executed. Claude's latest real call returned a recognized credit/usage-
limit error (HTTP 400), distinct from the app bug. Earlier Node-only success
did not establish hosted compatibility or future API balance.

## Read the Audit panel

1. Select the conversation and open **Audit** for its ten latest runs.
2. Check routing/response, provider, model, status, explanation, HTTP status
   if a response arrived, elapsed time, request reference and run ID.
3. `chat.started` is written by `begin_chat`; `chat.completed` is written in
   the same transaction as the reply/proposals. Caught failures update the run
   and append `chat.failed`. Replay does not run AI or add a second outcome.
   Old failure rows are not retroactively reclassified.
4. If failure persistence is unavailable, server logs emit
   `chat_failure_persist_failed` with the run ID, and still return the saved
   message receipt. Failure row and audit insertion are separate requests; a
   crash between them can leave a missing audit entry. The run trace provides
   another record. Status polling and replay now expire the same interrupted
   request after its 150-second lease. An uncertain completion write remains
   pollable until the database confirms the outcome.

| Code | Meaning / next step |
| --- | --- |
| `AI_QUOTA_EXCEEDED` | Provider reported API credit/usage limits; check its billing. |
| `AI_RATE_LIMITED` | Temporary rate limit; wait. Consented backup may be attempted. |
| `AI_KEY_INVALID` | Key authentication failed; check/rotate that server key. |
| `AI_ACCESS_DENIED` / `AI_MODEL_UNAVAILABLE` | Verify project/model access and configuration. |
| `AI_TIMEOUT` / `AI_NETWORK_ERROR` | No timely usable connection; do not infer missing credits. |
| `AI_TRANSPORT_CONFIG_INVALID` | Runtime-incompatible request options; needs an app fix. |
| `AI_REDIRECT_BLOCKED` | Unexpected redirect rejected; do not enable credential forwarding. |
| `AI_UNAVAILABLE` | Unavailable/interrupted provider; this alone does not establish a credit or key failure. |
| `AI_REFUSED` / `AI_INVALID_RESPONSE` | Terminal; never switch to circumvent refusal/validation. |

Backup uses only providers explicitly allowed by the owner. It does not create
free credits, transfer balances or bypass refusals. Readiness means a key is
configured, not that its account currently has credit.

## Saved message versus AI reply

The server returns `messageSaved: true` only after `begin_chat` confirmed the
persisted message, including completed/failed/working replays. The composer
then clears text/attachments even when AI fails; history keeps the message.
Sending is synchronously locked to prevent double-click submission.

When receipt delivery is uncertain, text and the same idempotency UUID are kept.
Retry unchanged input to retrieve that outcome instead of making a duplicate.
Paused processing is explained inline with a Connections shortcut; members are
directed to the owner. Ask James creation errors after reply commit do not
relabel the reply failed; a separate notice explains the missing case.

## Privacy and test boundaries

Diagnostics hold fixed codes, provider/model, stage, duration, HTTP status and
validated request IDs only. Never log raw bodies, prompts, files, headers, keys
or customer text. OpenAI receives a random `X-Client-Request-Id`; returned IDs
must match a bounded allowlist. See
[OpenAI request troubleshooting](https://developers.openai.com/api/reference/overview#debugging-requests).

API tests mock services; PGlite tests execute real migrations; the Worker test
exercises actual runtime request semantics. These complement one another but
do not prove full authenticated hosted chat, approval, uploads or real Calendar
execution. Do not delete customer conversations or Claude's audit messages as
test cleanup. The September repair requires
`202609050009_chat_and_connection_lifecycle.sql` before the updated server is deployed.
