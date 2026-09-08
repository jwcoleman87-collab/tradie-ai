# Isolated native database and browser verification

The critical runner requires real PostgreSQL, PostgREST and Chromium. It mocks Auth, Storage bytes and AI through the loopback gateway. Missing infrastructure and failing assertions exit nonzero. Real Supabase, provider billing/cancellation and external publication remain outside this suite.

Install application dependencies with `npm ci`, then install the separately locked test tools with `npm ci --prefix scripts/review/tooling`. This package contains pinned node-postgres and Playwright; it does not modify the application lockfile. Install Chromium using `node scripts/review/tooling/node_modules/playwright/cli.js install --with-deps chromium` on the Linux CI runner. An existing browser can instead be explicitly selected with `E2E_CHROME_EXECUTABLE`.

Run `node scripts/review/download-postgrest.mjs` to download the official PostgREST 16.2 archive. The downloader verifies its pinned SHA-256 before extraction. Linux x64 and Windows x64 archives are supported; an explicitly supplied `E2E_POSTGREST_BINARY` can use an already-provisioned executable. Release digests were checked against [the official v16.2 release](https://github.com/PostgREST/postgrest/releases/tag/v16.2).

The CI PostgreSQL service must be disposable and expose only host `127.0.0.1:55439`. Its superuser is `postgres`, with the deliberately synthetic password `synthetic-local-e2e-postgres`; set `E2E_ISOLATED_POSTGRES=1` to designate this test fixture. This flag is not permission to point at a production database: the wrapper never reads a production connection string and hardcodes loopback plus synthetic credentials. It refuses an existing test database or existing application roles. For native local operation, set `E2E_PG_BIN` to the directory containing `initdb`, `postgres` and `pg_ctl`; this creates and owns a fresh cluster instead of using a service container.

After `npm run build`, run `node scripts/review/run-critical-e2e.mjs`. It:

1. Requires an installed browser and a production build.
2. Creates a fresh synthetic database, fixtures for `auth.uid()`/Auth/Storage metadata, roles and grants, and applies every repository migration.
3. Configures all eight account policy fields through `configure_account_quotas` with explicit synthetic limits. The request caps are test fixtures, not proposed production defaults or monetary budgets.
4. Starts PostgREST, the synthetic gateway and the real built Next.js app, using bounded readiness checks and an external-network-blocking provider preload.
5. Runs the native database security/race, onboarding claim, account quota, HTTP isolation/integrity, runtime recovery, browser journey/edge and built-response/skill suites. Any failure fails the runner.
6. Sanitizes the browser trace and checks ZIP integrity. It requests graceful infrastructure shutdown by IPC, including on Windows, then waits before any forceful cleanup of its own processes.

Configuration:

| Variable                | Purpose/default                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_INFRA_CONFIG`      | Fresh generated config path; orchestrator defaults to `tmp/review-ci/infra-config.json`. Do not reuse an existing path/database. |
| `E2E_TOOLING_ROOT`      | Directory containing the test-tool package and `node_modules`; orchestrator defaults to `scripts/review/tooling`.                |
| `E2E_EVIDENCE_DIR`      | Evidence root; orchestrator defaults to `evidence/ci`.                                                                           |
| `E2E_PG_BIN`            | Optional explicitly provisioned native PostgreSQL binary directory.                                                              |
| `E2E_PG_PORT`           | Native connection port, default `55439`.                                                                                         |
| `E2E_DATABASE_NAME`     | Fresh name beginning `e2e_synthetic`, default `e2e_synthetic`.                                                                   |
| `E2E_POSTGREST_BINARY`  | Explicit PostgREST executable; otherwise the checksum-verified downloaded executable.                                            |
| `E2E_POSTGREST_ORIGIN`  | Loopback PostgREST origin, default `http://127.0.0.1:55440`.                                                                     |
| `E2E_GATEWAY_ORIGIN`    | Loopback synthetic gateway, default `http://127.0.0.1:55441`.                                                                    |
| `E2E_APP_ORIGIN`        | Loopback built application, default `http://127.0.0.1:3108`.                                                                     |
| `E2E_CHROME_EXECUTABLE` | Optional existing Chrome/Chromium executable; absent on Linux uses Playwright's installed Chromium.                              |
| `E2E_PYTHON`            | Python executable for trace sanitation; defaults to `python3` on Linux, `python` on Windows.                                     |

Standalone review scripts retain the earlier Windows sibling-tooling default when it exists. The orchestrator explicitly selects the portable package/config instead. All service origins must be plain HTTP on `127.0.0.1`.

The synthetic policy is Chat burst 12, daily 10,000, concurrency 1,000; onboarding burst 10 and daily 10,000; workspace active 20, total 10,000 and daily 10,000. Targeted quota tests temporarily use smaller limits and must restore the shared policy before browser/HTTP suites. The provider timeout is deliberately shortened to 1,000 ms; it does not measure the default production timeout or prove a remote provider stops billing.

Public evidence includes JSON assertions, screenshots and sanitized traces. Never upload `**/runtime/**`, generated infrastructure configs, database files or raw traces. They contain synthetic sessions and private diagnostic output. The cluster is retained locally for inspection after stopping; CI service/container lifetime is managed by GitHub Actions.

## Validation status

The portable native wrapper was executed on Windows against a fresh cluster on alternate ports 55449/55450: 15 migrations applied, separate native backend connections succeeded, PostgREST service access succeeded and anonymous access was denied, and IPC shutdown released both ports. Missing PostgREST was separately confirmed to exit 1 before starting a database. See `evidence/portable-infra`.

The full Windows orchestrator subsequently passed all nine mandatory suite commands against build `4jOWDovvtwxnsz4gdgoBl`. Native database checks passed 5, onboarding claims 6, account quotas 16; HTTP onboarding checks passed 6 and bilateral isolation 60; runtime recovery passed 3; browser journey passed 17 and supplemental browser checks 7; all 11 built-response checks and all five skill-file checks passed. The trace was sanitized and its ZIP integrity checked. Source SHA-256 `e12370adece88859aec6f363aa500341e7bf8cf1d41e09a58adc00adf92f6964` remained unchanged during the run. See `evidence/round2/critical-20260908-150338`.

Two startup failures are retained separately: a Windows Git safe-directory separator mismatch was corrected without changing global trust; a freshly downloaded PostgREST executable exited before readiness, while the identical-hash previously validated executable ran successfully from its existing path. The cause of that path-dependent startup failure was not isolated. No product tests were counted as passed in either failed attempt. Infrastructure failure now disconnects IPC and exits nonzero promptly.

The existing required `verify` job now includes a pinned PostgreSQL 18.4 service, nonmutating formatting, isolated tool installation/audit, mandatory Chromium and native/browser execution, and sanitized artifact retention. There are no skip guards or `continue-on-error` settings for the critical suite. Linux execution remains unverified; adding CI wiring does not establish a successful GitHub run. The actual candidate must receive required checks after separate authorization to push.
