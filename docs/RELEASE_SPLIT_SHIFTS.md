# Split shifts, daily checkout and missing uniform choices

## Behavior

- Weekly schedules and dated overrides accept an optional second regular shift. For example, 08:00–10:00 plus 14:00–18:00 credits six scheduled hours, with no pay for the four-hour break. Both separate QR visits and one session spanning the break are supported.
- Each materialized regular shift has a stable slot (1 or 2). Existing shifts remain in slot 1. Editing, cancelling or restoring one recorded shift preserves its sibling and the existing correction history and payroll protections.
- Both windows must finish on the same day, with the second starting at or after the first ends. API validation and database guards reject overlapping windows. Extra shifts and explicitly approved overtime retain their existing rules.
- The existing minute cron automatically closes open attendance at 23:00 Asia/Tashkent (18:00 UTC). A late cron catches up using the original workday's cutoff. Retries and concurrent manual checkouts preserve one closure. This runs independently of Telegram notification delivery. Locked payroll remains protected.
- The immutable `automatic_checkouts` journal records the cutoff, processing time and system reason without attributing the action to an employee or administrator. Personal attendance history marks automatic closes. Existing attendance corrections remain available when the recorded time needs correction.
- Check-ins from 23:00 until midnight are rejected; a new day's check-ins are accepted normally. Check-in also catches up any overdue automatic closures.
- An administrator can select Approved / wearing uniform or Rejected / no uniform without an employee declaration. Their choice is stored in `admin_has_uniform`, separately from the employee's declaration and with existing reviewer identity, timestamp, audit and revision checks. An employee's later declaration does not erase a completed review.

## Migration

`0012_split_shifts_auto_checkout.sql` adds optional second-window columns, regular shift slots, database guards, the automatic checkout journal and the administrator uniform observation. It preserves existing records. The original one-regular-shift index becomes one regular shift per slot. This migration must be applied together with the new Worker, because the old materializer uses the old unique-index conflict target.

## Validation and release

- All 270 tests across 17 suites passed. The two affected integration suites also passed separately: 56 tests, including the new cases for split shifts, independent recorded-shift cancellation/restoration, non-overlap validation, unchanged shift identities, six-hour credit for the example day, automatic checkout boundaries/delays/retries/concurrency, notification-independent closure, and administrator-supplied uniform observations.
- Type checking, the production Vite build, production configuration validation and the Worker deployment dry run passed. No browser automation session was available for interactive visual verification.

## Production release — 28 October 2026

- The user explicitly approved the owner-only production backup, migration and deployment after reviewing the implemented changes and validation results.
- Private backup: `backups/split-shifts-20261028-132635/database.sql`, 1,903,638 bytes. SHA-256: `01D4FBA9783720223D8DBC443790572E57C32A4CC8975389ACA5836C0F0FF3E4`.
- Migration `0012_split_shifts_auto_checkout.sql` applied successfully to the existing `staff-attendance-db`. No migrations remain pending.
- Deployed Worker version: `adbd4d8b-6c91-43aa-b92c-7e00ec366419`, using the existing Worker, custom domain, database, bindings and minute cron.
- Live site: https://staff.eshtaylakov.uz. Live frontend bundle: `index-X9e2WQCB.js`.
- `node scripts/verify-production.mjs` and `node scripts/verify-security.mjs` passed against the deployed site. These checks created no business records or messages.
- The production foreign-key check returned no violations and made no writes.
- The automatic checkout boundary and retry/concurrency behavior were tested with disposable local databases. A real 23:00 production checkout was not simulated by changing employee attendance.
