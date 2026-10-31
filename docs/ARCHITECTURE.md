# Architecture and phased plan

## Decisions

One repository, one same-origin frontend/API deployment, and one D1 database. React/Vite builds static assets; Hono runs the API in Cloudflare Workers. Vite proxies the API to Wrangler locally. No ORM, external authentication provider, Docker, Redis, background queue, or microservice is needed. Tailwind is compiled locally; no runtime CSS framework or third-party font is loaded. Telegram's official SDK is loaded only from its documented host.

`frontend` depends on `shared` types and validation concepts; `backend` uses shared validation and permissions. D1 SQL uses bound parameters. Pure salary/interval helpers now live in `shared/attendance.ts`. Phase 2 adds schedules, attendance, and a tablet-only reception PWA; see [the Phase 2 decisions and limits](PHASE_2.md). Production now runs Phase 5 under the owner's standing release authorization; see the Phase 5 release record.

## Data model in Phase 1

`users` holds the Telegram link, access type, and enabled state. An employee profile points to exactly one user. Admins can also have employee profiles; the bootstrap super administrator is initially an administrator only. Admin creation proceeds by onboarding an employee and promoting that account, rather than introducing a separate login system.

`roles` and `role_levels` use stable IDs; renaming/deactivation preserves references. `employee_role_history` and `hourly_rate_history` are append-only effective-dated records. The applicable assignment/rate is the latest effective date at or before the work date. Rates are integer UZS; effective dates mean midnight in Asia/Tashkent. Events/auth expiry use integer Unix seconds in UTC. Employment dates are local calendar dates. Current enabled state and activation/deactivation dates are preserved; complete rehire periods will need an employment-history migration before such reporting is required.

Current or future effective dates are accepted. Same-date replacement and historical rewriting are rejected. A historical correction workflow, with payroll locks, will be introduced in Phase 5. This keeps Phase 1 administrative actions from overwriting historic wage inputs. Historical records retain level IDs and original audit JSON; renamed role labels display the current name.

The first migration includes only foundation entities: users, employees, role/level catalog, assignment/rate history, permissions, bootstrap marker, auth sessions, consumed login hashes, rate limits, audit records, mutation idempotency keys, and system settings. Tables for attendance, reviews, requests, and payroll will be added with their phases so unimplemented state machines are not implied to work. Payroll start day is represented (1–28, default 1); editing it is deferred until payroll-period calculations exist.

## Identity and authorization

The backend verifies Telegram `initData` using the bot-token HMAC flow, rejects duplicate query parameters, validates the signed user ID, accepts at most five-minute-old logins and up to 30 seconds of forward clock skew. It never uses `initDataUnsafe`. The signed `signature` parameter is included in the bot-token HMAC check string when present, as distinct from Telegram's third-party Ed25519 flow.

Successful login exchanges the signed identity for a 12-hour random opaque session. Only its SHA-256 digest is stored in D1. Production uses a Secure, HttpOnly, SameSite=Strict `__Host-` cookie, never browser localStorage. Every private API checks the session, current enabled state, employment activation for ordinary employees, and current permissions. Access changes, deactivation, relinking, and logout revoke relevant sessions. Telegram initData is consumed once; reopening the Mini App is required after expiry, logout, or a consumed-login error.

Unregistered users are rejected. A matching `BOOTSTRAP_TELEGRAM_ID` may create one super administrator only after cryptographic Telegram verification and only while the singleton bootstrap marker is absent. Creation, marker, and audit are atomic. Changing/removing the secret later never creates another super administrator or reactivates a disabled one. Phase 1 deliberately disallows super administrator demotion or self-relinking. Provision additional emergency super administrator access only with a documented, reviewed operator procedure in a future phase.

Five separate admin capabilities are enforced server-side: employee management, salary editing, final payroll approval, attendance management, and audit viewing. Attendance administrators manage schedules, requests and daily reviews. Payroll approval independently controls financial decisions, finalization and reopening. Super administrators manage access grants and Telegram relinks. Employees receive only their own profile/rate. Company rates are redacted from catalog/team responses unless salary editing is granted. Admin-only routes reject ordinary employees even if the frontend sends another employee's ID.

Mutations require exact allowed Origin, JSON content, bounded bodies, and an idempotency key. Login/write limits are counted atomically in D1 per IP and minute. No permissive CORS is enabled. Production rejects HTTP. Protected responses are not cacheable. Static HTML has a restrictive CSP, permitting only the documented Telegram script host. Authentication secrets never enter Vite's environment or public assets.

## Atomicity and idempotency

Administrative changes, related history, audit, and a cached mutation result are submitted in one D1 batch. D1 batches execute transactionally. The unique `(actor_id, key)` constraint prevents concurrent duplicate commits; failed batches roll back. A retry with the same method/path/body/key returns the stored result. Reusing a key with a different payload returns 409. Idempotency results are retained in Phase 1; storage/retention policy should be added as usage grows. Database integrity constraints protect identity uniqueness, one profile per user, and one dated rate/assignment per target/date.

Future attendance and payroll transitions must use the same atomic approach, database unique constraints, and conditional state transitions; a frontend button lock alone is insufficient.

## Implementation plan and risks

1. **Foundation (this phase):** schema, auth/bootstrap, onboarding, roles and rates, permissions, navigation, local environment, security tests, build verification.
2. **Core attendance:** separate schedule/actual records, registered tablet PWA, expiring signed rotating QR, native scanner and fallback, multiple sessions, union-based payable intervals and exact actual time; test every supplied wage/rounding example.
3. **Employee management:** attendance/salary screens, absence/corrections/overtime/coverage, bot webhook and durable deduplicated notifications.
4. **Discipline and daily reviews:** minute-granularity lateness policy, deterministic monthly progression, proposed fines distinct from deductions, mandatory quality/uniform decisions, unified review queue.
5. **Payroll:** historical rates, integer currency calculation with documented final rounding, adjustments, snapshots/locks, CSV, audited reopen/adjustment process.
6. **Release verification:** full business tests, real Telegram and tablet testing, production security validation, operational guides, approved deployment.

Report at each phase boundary. The owner authorized completing Phase 4 verification and proceeding to Phase 5, including deployments and necessary migrations without a separate approval question.

Key risks: QR screenshots do not prove presence; Android/WebView cookie/scanner behavior needs real-device testing; pending/forgotten attendance must never accumulate unlimited pay; rate and disciplinary history must survive recalculation; future payroll locks must block historical material changes. Telegram/D1 availability and free-tier quotas have no application-level SLA. A manual correction path is planned, and no UI should claim an attendance success before a server confirms it.

References: [Telegram validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [Workers static assets](https://developers.cloudflare.com/workers/static-assets/).
