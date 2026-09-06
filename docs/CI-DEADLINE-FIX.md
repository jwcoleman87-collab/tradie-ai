# Deadline retry correction

The later [CI run 33930708328](https://github.com/jwcoleman87-collab/tradie-ai/actions/runs/33930708328)
failed one of 283 tests on documentation commit `a308bfa`. The earlier deployed
source's CI had passed, but the failure exposed a real timing race shared by that
source: after a deadline timer fired, the wall clock could still read just before
the deadline. Fallback checked that clock and created a new timer, allowing a
backup request to start after the original timeout.

Structured generation and research now convert each absolute stage deadline into
one shared cancellation signal. Adapters inherit that signal and add independent
per-attempt timeouts; they do not recreate the absolute-deadline timer. Once the
shared signal is aborted, retries stop regardless of clock rounding or clock
adjustments. A per-attempt timeout can still use a consented backup when the
shared budget remains. Model selection, consent, the overall Chat deadline and
the database lease are unchanged.

Four controlled-clock/signal tests replace the 15ms wall-clock test. They reproduce
both structured/research failures against the old implementation and pass against
the fix, while preserving successful per-attempt fallback controls. Full local
validation: **286 tests across 24 suites**, lint, typecheck and production build
pass. An independent review found no actionable issues.

The CI workflow also updates checkout and setup-node from v4 to the current v7
actions using Node.js 24. Its triggers, permissions, job, inputs and checks are
unchanged. Release references: [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0).

Current remote verification and deployment references are recorded in
[repair PR #3](https://github.com/jwcoleman87-collab/tradie-ai/pull/3).
