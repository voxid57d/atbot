# Production workflows release — 2026-10-11

Application: https://staff.eshtaylakov.uz. Reception: https://staff.eshtaylakov.uz/reception/.

The existing `staff-attendance-api` Worker and `staff-attendance-db` D1 database remain in use. Migration `0009_production_workflows.sql` was applied to production after a private backup. No demonstration staff, schedules, attendance, salary adjustments or messages were created in production by release checks.

## Resulting behavior

- Salaries use calendar months. Employees select a month in **My salary** and see their own provisional or finalized figures. Administrators use the month selector in **Payroll**. Payment execution and payment tracking belong to the separate LMS; new advance adjustments are rejected. Unused advance lines are hidden in the UI and CSV. Historical advance inputs, if any, remain compatible with preserved snapshots.
- QR tokens last 60 seconds. Both employee check-in and checkout require a current, signed QR from a registered display. Invalid scans leave the session open; checkout validates expiry and display registration again at the atomic database transition.
- Paired reception registrations have no server-side expiry and remain valid until revoked. Browser cookies renew during active use within the browser's 400-day limit. Clearing site data still removes pairing. All four non-revoked paired production registrations were converted to permanent registration.
- The employee home shows today's schedule, attendance status, one main scan action and uniform choice. Monthly history and request forms follow below. Pending uniform declarations can be corrected with an optional reason; administrator-reviewed choices must first be returned to pending. Completed reviews and payroll locks remain protected.
- Daily schedules can be corrected after attendance or on past dates, with a credited-time preview and immutable before/after history. Original attendance timestamps remain intact. Finalized months require reopening; accepted coverage shifts retain their separate workflow. Recurring changes use a later effective date instead of rewriting recorded history.
- A seven-day calendar shows regular/extra shifts, approved absences, coverage and recorded attendance. Employee cards in the admin queue show outstanding work and links to decision screens. Focused views offer **Show all employees**.
- Audit history describes rate and schedule changes, attendance, uniform choices and reviews in plain language. Full original records remain expandable. An unchanged active account is not described as reactivated.

Reasons remain optional. Bonuses, deductions, explicitly approved fines and manually approved leave pay remain salary-calculation inputs.

## Validation

The full suite passed: 193 tests across 11 files. A subsequent audit wording regression and its three existing audit tests also passed. TypeScript and the production build passed. A Wrangler deployment dry run passed.

Synthetic local browser checks passed at 320, 390, 768 and 1280 pixel widths: scan in/out, pending uniform correction, adjacent-month selection, recorded-day correction, calendar absences and accepted coverage, employee-focused admin links and readable audit. Preview images are in `docs/previews/production-workflows-*.png`. Physical Telegram/Android scanner checks remain for staff to confirm during genuine use; browser stubs do not establish native device behavior.

Live production checks passed for the deployed HTML/assets, API health, reception PWA resources, unauthenticated private endpoints including `/api/payroll/mine`, forged sessions, cross-origin requests, body/content-type limits and webhook-secret enforcement. No foreign-key violations or unfinished schedule-correction contexts were found. Salary start day is 1. There were no persisted salary periods or advance adjustments before the release.

Backup: `backups/production-workflows-20261011-135302/database.sql`, 215,297 bytes, SHA-256 `B4836DACFF52A9DE4C4459FC3517870E881CE8E3CEDA058451B1633418BF7BC1`. The backup directory uses owner-only Windows permissions; it contains private data and must remain private.

Initial deployment version: `df4270a8-d61e-45d3-8190-be4fb3cd12b7`. Final deployed version, including the audit-wording refinement: `1a323d90-47e5-4176-95d0-5c886ef49a80`. Final JavaScript bundle: `index-Cl5cJrzJ.js`.

## After release

Close and reopen the Telegram Mini App. Refresh each reception display once to load the one-minute QR policy and updated service worker. Keep the tablet online; expired/offline codes are hidden and retry behavior is preserved. Do not clear tablet cookies unless pairing again is intended.

Before future releases, follow the private backup and recovery runbook. Avoid restoring a pre-migration backup directly over live data; older Worker versions expect expiring display credentials and are not a complete rollback for the new policy. Preserve finalized salary versions and use audited reopening when correcting locked inputs.
