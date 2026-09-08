# Account quota configuration

Migration `202609080004_account_quotas.sql` makes the database policy authoritative. Apply every migration before accepting new work. The migration deliberately leaves new ceilings unconfigured: new Chat requests, new onboarding requests, workspace creation and restoration fail with `QUOTA_CONFIG_INVALID` (503) until an administrator supplies the complete policy. Public pages, ordinary reads and existing workspace bootstrap do not require quota configuration.

Populate these deployment environment variables. Values must be integers from 0 to 2147483647; **explicit zero disables that ceiling**. Missing, blank, negative or fractional values never silently mean unlimited.

| Environment variable             | Scope                                                  | Default                 |
| -------------------------------- | ------------------------------------------------------ | ----------------------- |
| `ACCOUNT_CHAT_BURST_LIMIT`       | Accepted Chat requests per account per fixed minute    | 12                      |
| `ACCOUNT_CHAT_DAILY_LIMIT`       | Accepted Chat requests per account per UTC day         | Explicit value required |
| `ACCOUNT_CHAT_CONCURRENCY_LIMIT` | Working Chat runs with unexpired leases per account    | Explicit value required |
| `ACCOUNT_ONBOARDING_BURST_LIMIT` | Accepted setup answers per account per fixed minute    | 10                      |
| `ACCOUNT_ONBOARDING_DAILY_LIMIT` | Accepted setup answers per account per UTC day         | Explicit value required |
| `ACCOUNT_WORKSPACE_ACTIVE_LIMIT` | Active workspaces per personal owner                   | 20                      |
| `ACCOUNT_WORKSPACE_TOTAL_LIMIT`  | All workspaces, including archived, per personal owner | Explicit value required |
| `ACCOUNT_WORKSPACE_DAILY_LIMIT`  | New workspaces per personal owner per UTC day          | Explicit value required |

The three numeric defaults preserve existing limits while applying request limits across the account. There is no inferred production default for the five new ceilings and no monetary limit. CI uses explicit synthetic fixture values; they are not deployment recommendations.

Validate the intended environment without a network call:

```sh
node --env-file=.env.local scripts/configure-account-quotas.mjs --check
```

For an authorized deployment, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the intended database and explicitly apply the validated policy:

```sh
node --env-file=.env.local scripts/configure-account-quotas.mjs --apply
```

The setup command sends all eight values in one service-role-only `configure_account_quotas(p_policy jsonb)` transaction. Invalid updates leave the prior policy intact. Editing an environment variable alone does not change an already configured database. Reapply the complete policy when changing limits. Never expose the service-role key to browser code. Runtime requests do not modify policy, and browser payloads or optional RPC arguments cannot select limits.

Accepted request IDs are recorded in `account_ai_requests`. Retries replay the existing receipt; provider fallback remains within that one charged run. Onboarding acceptance charges in the same transaction that saves the answer and claim, so rejected or rolled-back claims leave no charge. Queued accepted answers count toward request limits and do not charge again when promoted. Existing Chat receipts are backfilled on migration. Legacy completed onboarding transcripts can be replayed without another charge.

Burst and daily errors carry bounded `retryAfterSeconds` and HTTP `Retry-After`. Active capacity errors clear when workspaces are archived; a total capacity limit includes archived workspaces and has no scheduled reset. Chat concurrency clears when running work is terminal or its bounded lease expires. Changing or disabling a limit does not delete accepted-request history.

The PostgreSQL review harness uses explicit fixture policies in disposable local databases. `scripts/review/native-account-quotas.mjs` records actual independent-connection blocking, quota/claim rollback assertions, reset behavior and cleanup. Its separate database prevents test policy changes from affecting parallel HTTP/browser fixtures.
