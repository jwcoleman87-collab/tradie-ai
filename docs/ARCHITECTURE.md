# Architecture and trust boundaries

## One repository, separate preparation and execution

React UI → same-origin authenticated API → Supabase Auth + user-scoped RLS reads.
Server-only operations write through reviewed service-role code and narrow SQL
transactions. Runtime uses HTTP APIs and is Cloudflare Worker compatible. The
backend lives in this app rather than separately deployed Supabase Edge
Functions; Supabase still owns Auth, Postgres and Storage. No second backend repo.

Chat request → begin_chat (idempotency, consent, tenancy, rate limit) → structured
model routing → selected Markdown skills → validated response → complete_chat
(message, run, skill hashes and proposals in one transaction). Model output is
never an executable tool call. Only four allowlisted proposal types exist:
calendar.create, draft.save, record.create and facebook.publish.

Owner Accept → decide_action (immutable approval receipt) → separate
claim_action → connector execution → finish_action (result, state, audit).
Deny cannot execute. Concurrent claims use row locks; leases recover interrupted
requests. Completed actions do not execute again. Failed actions can retry up to
five attempts using the original approval, except uncertain Facebook sends,
which cannot automatically retry. Google IDs derive from the immutable
action UUID; conflicts are retrieved and verified against the private action ID.

Calendar proposals are bound to the specific connection identity. Reconnecting
invalidates old calendar proposals/approved actions rather than redirecting them
to another account. The OAuth callback binds random state, an HttpOnly SameSite
cookie nonce, PKCE, a verified owner and a ten-minute expiry. It consumes state
once before token exchange. Refresh tokens are AES-256-GCM encrypted using a
workspace-bound additional authenticated value and never returned to a browser.

## Landing, sign-in and onboarding boundary

The signed-out root route is a static public landing surface and never queries
workspace data. `/sign-in` owns account confirmation and password recovery,
`/onboarding` owns first-run business discovery, and `/workspace` retains the
existing three-panel product. All browser auth consumers use the same Supabase
session hook; API requests still authenticate the bearer token server-side.

Onboarding uses a separate, bounded turn contract rather than the normal
five-crew routing loop. It stores only concise messages, information goals and
schema-validated profile facts — never model chain-of-thought. Each fact carries
a source reference, source label, confidence, state and observation time. New
profile, fact and session tables have tenant-read RLS and no browser write
grant. Server endpoints verify membership and owner role before service-role
writes; confirmation is a separate operation and creates an audit receipt.

`lib/server/discovery.ts` is the public-evidence adapter boundary. The initial
adapter deliberately returns `unavailable` and no evidence. The UI therefore
says that only owner-supplied answers were used; it cannot imply that a website,
registry or business-profile search ran. A future provider must use an approved
API, timeouts and a host allow-list before it can populate discovered facts.

## AI providers and consent

Workspaces choose a primary provider, a backup setting and an allowlist of
providers that may receive context. Existing consent migrates to OpenAI-only.
The server intersects this allowlist with configured private keys; no model
output can select or authorise a provider. Responses and Messages adapters share
the original strict Zod output contracts and have no execution tools. Claude’s
transport schema removes unsupported constraints but original validation remains.

Availability/quota fallback can advance once to the other eligible provider and
stays there for the rest of that request. No refusal/invalid-output fallback,
parallel races or endless retries exist. A run has two successful model stages
and at most three attempts. Provider/model/error-code trace and token usage are
persisted transactionally with the completed chat; failed runs retain available
trace/usage. These metadata do not contain prompts, files, keys or provider error
bodies. Account balances and exact billing are not represented as known.

## Additional integrations

The server-only credentials table is keyed by workspace + provider. Each
connection has a fresh immutable identity. Calendar’s original ciphertext/AAD
are preserved; Facebook/Ads JSON credentials use workspace + provider + identity
as authenticated encryption context. OAuth state includes the provider and uses
provider-specific callback cookies. Google flows also use PKCE.

Facebook and Ads callbacks create encrypted, expiring candidates. The owner must
explicitly choose an eligible Page/advertiser; selection verifies it with the
provider before an atomic, owner-checked consume/upsert. Browser responses never
include credentials. Disconnect removes only that workspace/provider connection
and pending selections; it does not claim to revoke the upstream account grant.

Facebook proposals bind exact Page ID and connection identity at creation,
approval and execution. The server records a durable send intent before posting.
A confirmed receipt is replayed; a previous sending/uncertain marker blocks a
second POST even after a crash. Explicit structured Graph rejection permits a
retry. Do not infer exactly-once delivery or clear uncertainty automatically.

Google Ads exposes fixed read-only account/report queries. The API cannot accept
arbitrary queries, modify campaigns or spend money. Account ID, manager context,
currency, time zone and period remain attached to reports. Reports are not
automatically supplied to the AI team. OAuth candidate retention cleanup,
provider-revocation webhooks and self-service uncertain-post reconciliation are
not implemented and remain production follow-up work.

## Tenant model

Every business-owned row includes workspace_id. Child conversation/action/run
foreign keys include workspace_id so unrelated parents cannot be linked.
Membership is a database row, never user-editable Auth metadata. Browser roles
have SELECT only and RLS. Server RPCs taking actor IDs have EXECUTE revoked for
PUBLIC, anon and authenticated. The backend always authenticates the JWT before
passing the verified user ID. Owner-only actions are checked again in SQL.

Agent skill bodies stay in the server source bundle. Metadata and release hashes
are recorded in agent_versions; no client write policy or customer edit endpoint
exists. AI knowledge does not automatically change managed instructions.

## Workspace and record lifecycle

One owner may maintain multiple isolated workspaces. Each is classified as a
business workspace or sandbox; integrations, credentials and private records
remain tenant-bound and are never copied during workspace creation. Workspaces,
conversations and business records use reversible active/archive states.

Archived containers are read-only. Database triggers reject new conversations,
runs, messages, proposals and files until the container is restored. Archiving
is blocked while a model run or approval/execution state is live. Completed,
denied and expired actions are history rather than active approvals; resolved
cases are also separated from open cases. Every lifecycle transition creates an
append-only audit receipt. See `WORKSPACE-GOVERNANCE.md` for retention classes,
legal holds and disposition responsibilities.

## Privacy

Private escalation_cases store Problem, Solution and Outcome under one Case ID.
Support sharing creates a separate support_cases row with an allowlist of fields
and categorical problem templates. The private free text, workspace ID,
conversation, uploads, names, addresses and tokens are absent. Regex-based
anonymisation is not used as a privacy guarantee. A separate operator registry
controls central support reads and grants no tenant membership.

The owner can record a private resolution; only closed/open status propagates to
support. Automatic chat and execution-failure cases are private, not silently
shared. No knowledge pool or automated operator response is represented as live.

Audit receipts hold actor/entity IDs, event names and limited metadata, never
prompts, filenames, attachment contents or OAuth tokens. Audit and approval rows
are append-only at application level; database administrators can still change
database policy. Production access must be governed outside this application.

## Operations and failure modes

- Missing setup → HTTP 503; no mock success fallback.
- Invalid/expired session → 401; wrong tenant or approval role → 403.
- Duplicate chat UUID → existing run, no duplicate user message/proposal.
- Incomplete, refused or invalid AI output → failure; no execution path.
- Unknown action type → rejected by server schema and SQL CHECK constraint.
- Expired pending approval → expired state; no approval row.
- Network uncertainty during Calendar execution → deterministic-ID reconciliation.
- Network uncertainty during Facebook publication → block repost and review Page.
- Upload errors → best-effort object cleanup and failed metadata; not AI-readable.
- Support errors never send raw provider errors or customer context to logs.

Before production add monitoring alerts based on error codes/request IDs, backup
restore drills, malware scanning if accepting untrusted business files at scale,
retention/export/deletion policies, verified OAuth/SMTP, and broader integration
and browser acceptance coverage. Configure infrastructure logs to redact OAuth
callback query parameters. Do not log Authorization headers or request bodies.

Polling/manual Refresh is used rather than Realtime subscriptions. The app has
no background execution queue; approved jobs execute in an HTTP request, and a
user can safely resume an expired lease. Larger jobs need a durable worker queue.
