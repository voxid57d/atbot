# Checkout grace periods

Deployed 17 October 2026 to https://staff.eshtaylakov.uz using the existing staff-attendance-api Worker and staff-attendance-db database. No schema migration was needed.

## Behavior

- Normal active attendance stays Working and does not create an open-attendance payroll issue.
- At the expected end, the employee sees a gentle reminder. At 30 minutes it becomes Checkout overdue. At 60 minutes it enters Needs checkout review and the administrator receives one reminder per session.
- Connected approved overtime or approved extra shifts extend the expected end. Midnight alone never triggers an alert. Unscheduled attendance uses check-in plus 18 hours as its expected end, followed by the same grace periods.
- Payroll cards show In progress - pay pending checkout. Open sessions remain excluded from calculated earnings and independently prevent payroll finalization, even if they have not reached the review deadline.
- Queued checkout reminders are rechecked before delivery. Checkout, corrections, changed timing, and employee reminder preferences suppress stale messages. Unsent reminders postponed by overtime become eligible at the new deadline; sent messages are not repeated.
- Existing same-day scheduling and the 18-hour live-time display cap are unchanged. This release does not add overnight schedule creation; absolute timestamps in the checkout rule are safe across midnight.

## Validation

The production TypeScript/Vite build, release configuration check, and Worker deployment dry run passed. All 69 tests in the four affected suites passed on the final code, including nine checkout regression cases. A broader regression run also passed the 190 tests outside those suites. Coverage includes normal active sessions, the exact 30/60-minute boundaries, midnight, connected approved overtime, unscheduled fallback, clearing alerts after checkout, notification deduplication and stale-message suppression, and payroll finalization safeguards. No schema migration is pending.

## Production release

- Worker version: `bcd5d2b7-f630-4b73-a03f-b29cbffc5cc8`.
- Live frontend bundle: `index-D0je7JhV.js`.
- The user explicitly approved the full production database backup to the owner-only local release folder before deployment.
- Private backup: `backups/checkout-grace-20261017-084243/database.sql`, 820562 bytes.
- Backup SHA-256: `4EECE19DAF1238310CBF5D91F70C0E051646C3E3AB8EF7BE5B96142EC73B2721`.
- `verify-production.mjs` passed, including the tested frontend bundle, API health, private endpoint protections, and reception assets.
- `verify-security.mjs` passed. These checks created no business records or messages.
- The remote database foreign-key check returned no violations and made no writes.
- The existing custom domain, bindings, production settings, and minute notification cron were preserved.
