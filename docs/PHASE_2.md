# Phase 2: core attendance

Completed and deployed on 10 October 2026, after explicit owner approval. The existing Worker and D1 now run Phase 2. No new Worker/database or synthetic production employee/attendance was created. See [the production release record](PRODUCTION_RELEASE_PHASE2.md).

## Implemented

- Reception PWA at `/reception/`, with tablet-only registration, one-use five-minute pairing codes, hashed credentials in D1, HttpOnly cookies, 30-day credential expiry, and super administrator revocation.
- Server-signed QR tokens in fixed 30-second windows. Tokens use a domain-separated HMAC with the existing Worker bot secret; they contain a display identifier and expiry, no employee data. Check-in verifies the current registered display, server time, employee status, and verified session identity. Display credentials never grant administrative access.
- Telegram Mini App native QR scanning, with a camera fallback loaded only when needed. The reception screen hides expired/offline codes and caches only its public shell/assets. Attendance writes always require a live server response.
- Exact integer Unix-second check-in/out, multiple sessions per workday, one active session per employee, atomic checkout transitions, audited admin closing with a reason, and safe idempotent retries. Duplicate concurrent requests cannot add sessions or close/audit a session twice.
- Effective-dated weekly schedules, one-day overrides and cancellation, additional shifts, and dated materialized regular schedule snapshots. Attendance prevents later rewriting of its regular schedule. Changes are current/future dated. One regular shift per employee/day; shifts finish the same calendar day.
- Employee attendance view with active timer, exact session timestamps, actual versus credited time, upcoming shifts, and a basic gross earnings estimate. Admin live attendance includes date/status filters, open sessions, lateness, and forgotten checkout flags.
- Explicit advance/retrospective overtime interval approval. Only actual, closed intervals outside the regular schedule are credited. Overlapping approvals and extra shifts do not double-pay, and gaps remain unpaid.

## Files

New files: `backend/http.ts`, `backend/qr.ts`, `backend/schedules.ts`, `backend/attendance.ts`, `shared/attendance.ts`, `frontend/attendance-ui.tsx`, `frontend/schedules-ui.tsx`, `frontend/reception.tsx`, `public/reception/manifest.webmanifest`, `public/reception/icon.svg`, `public/reception/sw.js`, `database/migrations/0002_attendance.sql`, `tests/attendance.test.ts`, `tests/attendance-api.test.ts`, `scripts/smoke-phase2.mjs`, and this report.

Updated foundation routing/idempotency, frontend navigation/copy/styles, dependencies and lockfile, foundation API fixtures, local smoke checks, README and operational/architecture/test documentation. The existing `wrangler.jsonc` resource/settings configuration was preserved.

## Calculation rules

Actual attendance and credited pay intervals are separate. Only the first arrival associated with a regular shift rounds down to its scheduled hourly block. For a shift starting 08:30, 09:29 credits from 08:30 and 09:30 credits from 09:30. Subsequent sessions start exactly at their check-in. Checkout is exact. Zero-duration sessions earn nothing. Intervals are unioned to prevent overlapping payment.

At 12,000 UZS/hour, the supplied examples pass: 08:00–17:00 and 08:35–17:00 earn 108,000; 09:00–17:00 earns 96,000; 08:35–16:30 earns 102,000; 09:20–16:30 earns 90,000 UZS. These are gross estimates assuming any required departure review, not approved final payroll.

Historical role/rate boundaries split credited intervals at Tashkent midnight. Calculation uses BigInt `hourlyRate * seconds` numerators, with division by 3,600 and half-up rounding once for the period's whole-UZS total. Daily amounts are individually rounded for display and can sum differently from the period total. Missing wage inputs are flagged, not silently treated as a configured zero wage.

Lateness is elapsed whole minutes: arrival at start+59 seconds is 0 minutes late; start+60 seconds is 1. No fines or disciplinary violations are created in Phase 2. Open sessions show at most 18 hours of provisional actual time and earn no estimated pay until closed. A previous-day or over-18-hour session is flagged for administrator review; exact closed attendance remains preserved.

## Local setup and reception pairing

```powershell
npm run build
npm run db:migrate
npm run dev
```

Use `http://127.0.0.1:5173`. Sign in using newly generated fake local data from `npm run test:login`. Configure a role level/rate, onboard an employee, and set their weekly schedule. Use `npm run test:login -- <employee-telegram-id>` for that employee's local sign-in.

As super administrator, open **Reception displays**, register a named display, and copy the pairing code. Open `/reception/` in another local browser profile and enter it within five minutes. This local rehearsal does not provide phone/tablet access over the network: real camera/PWA/Telegram device checks require the eventual approved HTTPS deployment or a separately approved HTTPS test environment.

After an approved release, open `https://staff-attendance-api.voxid-mr.workers.dev/reception/` in Chrome on the Samsung Galaxy Tab A9, enter the pairing code, choose Chrome's **Install app / Add to Home screen**, and keep the display open. Use the full-screen button as appropriate; adjust the tablet's sleep/display settings manually. Re-register after 30 days or revocation. Employees open the existing Mini App through Telegram, press **Scan reception QR**, and press **Check out** when leaving.

## Validation

- `npm run check`: **91 tests passed**, TypeScript passed, Vite production build passed.
- `npm run db:migrate`: `0001_foundation.sql` and `0002_attendance.sql` applied successfully to the isolated local database. Production was untouched.
- `npx wrangler deploy --dry-run --outdir .wrangler/phase2-dry-run`: Worker/static asset bundling passed without deployment.
- `node scripts/smoke.mjs`: existing signed login, D1 health, protected routes, replay rejection, and logout passed through the running local Worker.
- `node scripts/smoke-phase2.mjs`: PWA files, tablet pairing, signed QR, employee check-in/out, two sessions, employee summary, and admin live attendance passed through the running local Worker. Clearly named LOCAL SMOKE records remain locally for audit; the test employee/level were disabled and the display revoked.
- Integration tests apply both migrations to disposable real Miniflare D1 databases and cover permission boundaries, consumed/expired pairing, expired/revoked credentials, tampered/expired QR, disabled employees, schedule snapshot protection, concurrent same/distinct-key actions, admin closes, and overtime bounds.
- Browser verification could not run because the browser connection failed. Native Telegram scanner permissions, camera fallback, Android PWA installation/offline recovery, and visual layout require real-device checks. Those checks are not claimed as passed.

## Release boundary and remaining work

`0002_attendance.sql` was tested locally and subsequently applied to production after owner approval. It creates attendance/scheduling/display tables, indexes and protection triggers without deleting Phase 1 records or seeding real schedules/wages. No new Worker secrets are needed; the existing `TELEGRAM_BOT_TOKEN` signs QR tokens. `BOOTSTRAP_TELEGRAM_ID` remains the foundation bootstrap secret. Tablet pairing/credentials are application records, not Cloudflare secrets. Bot webhooks and notification secrets are deferred to Phase 3.

The approved release inspected production, saved a private backup, applied the pending migration and deployed the existing Worker. Future releases require separate explicit approval. Do not deploy Phase 2 code with only the Phase 1 schema: its health route checks for attendance schema readiness. See [Cloudflare setup](CLOUDFLARE_SETUP.md).

Phase 3 remains unstarted: absence/correction/overtime requests, shift coverage, employee management workflows, and Telegram notifications. Early-departure approvals, disciplinary reviews/fines, payroll locking/finalization, configurable overtime multipliers and employment rehire history are later work. Historical schedule edits and closed-session corrections deliberately require a later audited correction workflow.

A QR screenshot shared within its short validity window can still be used remotely; QR alone does not prove physical presence. A tablet loses its registration if cookies are cleared. During an outage, use a manager-controlled paper record and later an approved correction process; no offline attendance is queued or silently accepted.

Schedule materialization batches rows using SQLite JSON input to avoid a separate D1 query for every employee/day. Reception polls about once per 30-second window; visible employee/admin screens refresh every 30 seconds. This reduces polling/query load, but free-tier row/request/CPU limits still need monitoring at release. No cron reminders or notification queue are introduced yet.

References: [Telegram scanner methods](https://core.telegram.org/bots/webapps), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Approved production release

The Phase 2 migration/deployment and live HTTP checks passed after owner approval. A remote SQL parser incompatibility was corrected with equivalent trigger SQL and LF line endings; fresh attendance API tests passed before retry. Details and version/backup records are in [the release report](PRODUCTION_RELEASE_PHASE2.md). Real-device scanner/installation verification remains outstanding.
