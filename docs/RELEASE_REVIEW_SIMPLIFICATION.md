# Review simplification and bug fixes — 31 October 2026

## Behavior

- **Daily reviews:** one "Confirm day" button saves quality and uniform together, starting on Good and Approve (Missing uniform when the employee declared none). "Approve all as shown" confirms routine days in batches of five; days with lateness, early departures, requests, a declared missing uniform or a hand-changed choice stay for individual review. Notes sit behind "+ Add note" and are required for Bad, Missing uniform and changes in History.
- **Navigation:** "Today" groups Review inbox, Live attendance and Requests; "Settings" groups Roles & rates, Reception displays, Admin access and Audit history. Page ids and deep links are unchanged. The header "Staff workspace" tag and "SESSION PROTECTED" label are removed.
- **Fixes:** editing an employee sends only changed fields, so renaming no longer signs them out or overwrites a disabled employee's end date; old workers.dev app links redirect to `https://staff.eshtaylakov.uz` (reception, assets and the webhook stay on their host); hourly cleanup of idempotency keys older than 7 days and webhook replies older than 30 days; role/level labels corrected; sign-out fully resets state.
- **Configuration:** `run_worker_first` now includes `/` so the root page runs the Worker and the old-host redirect applies. Local `dev:api`/`preview` use `--local-upstream` because the custom-domain route made `wrangler dev` rewrite local requests to the production host.

## Data and rollout

No schema migration. New endpoint `POST /discipline/days` reuses the existing quality/uniform validation, triggers and audit records in one atomic batch under one revision guard.

## Verification

- 296 tests in 19 suites passed; production build passed.
- Local headless-browser check with synthetic records: no page errors; Confirm day, Approve all, Today and Settings tabs behaved as described.
- `verify-release-config`, deployment dry run, `verify-production`, `verify-security` passed. Remote migrations: none pending. `PRAGMA foreign_key_check`: no violations.
- Old host: `/` returns 302 to the custom domain; `/reception/`, `/brand/*`, `/assets/*` return 200; webhook still rejects requests without the secret (403).
- Not performed: real Telegram or tablet walkthrough.

## Release record

- Private backup: `backups/review-simplify-20261031-140624/database.sql`, 2,563,632 bytes, SHA-256 `AD04043D22F11843B2A46C3CCD2087C9846ACA1F3527E47EB4768B11ADFA298C`.
- Rollback target (previous version): `772a0ac9-13a5-4504-93e9-2a8057911f1e`.
- First deploy `031db348-5b2d-46ff-b0ad-1a5e7f0a0ebe` served pages without the old-host redirect; corrected by `49f4a2da-3294-4937-a1eb-d849e48566d2` (current).
