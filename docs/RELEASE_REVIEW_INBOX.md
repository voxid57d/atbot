# Review inbox and consistency fixes — 29 October 2026

## Behavior

- Monthly salaries separates Pending from History. A valid saved approval or rejection removes its fine from Pending. Salary adjustments and fine decisions have an accurate combined history count; obsolete decisions are labeled superseded and are not applied to salary.
- Fine approval uses an explicit Approve amount action, with integer bounds, and Reject fine (zero), which always submits zero. Existing decisions require Change decision before editing. Fine forms are not offered before the lateness prerequisite is resolved.
- A shared server task model supplies the review inbox, overview count, salary warnings and guided review. Tasks identify the employee, date, subject, source version, state, prerequisite and required permission. Pending includes unresolved decisions; waiting decisions explain their prerequisites. Locked months are excluded from the daily pending queue.
- The inbox groups decisions by employee and workday. Each day shows both schedule windows, recorded visits, recorded duration, credited time, paid hours and per-shift lateness/departure details. Quality review waits for closed attendance and the last scheduled shift. Uniform and disciplinary decisions remain explicit; there is no automatic Good or financial approval.
- Continuous visits across split regular shifts use the last regular window for checkout timing. Their breaks remain unpaid. Separate extra shifts still do not extend the visit unless connected approved overtime applies.
- Early-departure review includes visits spanning multiple regular windows. Daily lateness totals include each regular shift and agree with discipline. A no-attendance payroll task becomes due only after the last regular shift ends.
- Relevant source changes preserve an edited draft and block submitting it until current values are loaded. Untouched forms refresh automatically. Shared form/resource primitives now live in `frontend/ui.tsx`, removing their circular dependency on attendance, requests and discipline screens.
- Fine history includes the deciding administrator and Tashkent timestamp. Superseded financial decisions remain visible in history; complete changes remain in the existing audit log. Existing idempotency, revision checks, authorization, payroll locks and immutable salary versions are retained.
- Fine policy tasks identify the super administrator as their owner. Locked-record guidance directs users to a payroll approver for reopening. Guided request navigation can focus the actual request. Labels distinguish recorded duration, credited time, paid hours, fine proposals and financial decisions.

## Preserved policies

The owner confirmed that backward first-arrival pay credit and monthly fine progression are intended. Both are preserved and regression-tested: arriving at 08:12 for an 08:00 shift can receive credit from 08:00 while recording 12 minutes late, and a later shorter lateness can carry a higher fine because of its monthly position.

Daily completed-hour salary counting, historical rates, cashier bonus rules, explicit financial approval, manual leave pay, 23:00 automatic checkout and payment tracking in the LMS retain their existing behavior. This release does not introduce a new automatic-checkout approval policy or weaken the shared revision guard.

## Data and rollout

No schema migration is needed. All changes use the existing tables and audit mechanism. Finalized salary snapshots continue to read their saved versions. Open-month review results update to the corrected split-shift rules; a newly detected unresolved departure may therefore appear as a legitimate new review task.

## Verification

Final test, build and deployment results are recorded below after completion. Existing tests use disposable Miniflare D1 databases, never the production database or persistent local data. Rendered React tests cover pending/history separation, rejection payloads, superseded decisions, prerequisite gating and matching inbox counts. New D1 tests cover spanning early departure, afternoon lateness across views and no-show timing. Shared-rule tests protect the intended salary-credit behavior.

Browser inventory was empty and creating an in-app browser returned “Browser is not available: iab.” Interactive mobile/desktop and real Telegram/tablet verification were unavailable in this session; rendered-screen tests do not claim to replace those checks.

## Final validation and release status

- All **289 tests in 19 suites passed**, including actual disposable Miniflare D1 integration tests, using `npx vitest run --fileParallelism --maxWorkers=2`.
- An existing authentication-rate test could cross a real minute boundary. Its clock is now fixed during the test, and it also verifies that attempts are accepted again in the next window. Production authentication and rate-limiting behavior were not changed.
- `npm run build` passed, including TypeScript checking. Main frontend bundle: `index-BRUj-nUx.js`; stylesheet: `index-DxN_buE4.css`.
- `node scripts/verify-release-config.mjs` and the final Worker deployment dry run passed with the existing Worker, D1, origin, assets and minute cron.
- Production migration status: no pending migrations. The read-only production foreign-key check returned no violations and wrote zero rows.
- Previous production version / rollback target: `adbd4d8b-6c91-43aa-b92c-7e00ec366419`.
- **Deployed after explicit owner approval** of the private production export and deployment. The initial automatic-review rejection was resolved by that approval.
- Owner-only backup: `backups/review-inbox-20261029-093006/database.sql`, 2,119,890 bytes. SHA-256: `29D536DEB8517B1FDE68B614576E2F9B20020D3CB4921E002DCA3B217E5E9372`.
- Deployed Worker version: `772a0ac9-13a5-4504-93e9-2a8057911f1e`, using the existing Worker, D1, custom domain, bindings and minute cron. Live site: https://staff.eshtaylakov.uz.
- `node scripts/verify-production.mjs` and `node scripts/verify-security.mjs` passed after deployment. The live HTML references the tested `index-BRUj-nUx.js` build. Verification created no business records or messages.
- Post-deployment migration status: no pending migrations. The read-only foreign-key check returned no violations and wrote zero rows.
