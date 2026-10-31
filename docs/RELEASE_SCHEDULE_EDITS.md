# Schedule editing release — 2026-10-10

Administrators with attendance management permission can edit saved recurring weekday schedules and individual shifts. Forms are prefilled and require a reason. Daily edits create an override without changing recurring hours; shifts can be cancelled or restored, and extra-shift approval can be changed. Later recurring effective dates preserve the earlier version.

Recorded attendance and locked payroll are protected in both the API and database. Accepted coverage shifts cannot be silently altered through this editor. Revision checks reject stale and concurrent edits, and idempotent retries preserve a single audit entry. The schedule view has a refresh control for reopening stale editors.

Migration `0006_schedule_edits.sql` adds nine protection/revision triggers without rewriting existing business records. It targets the existing `staff-attendance-db` binding `DB`; deployment targets the existing `staff-attendance-api` Worker.

Validation: seven new isolated-D1 integration tests cover weekly versions, audit history, daily overrides, cancellation/restoration, extra-shift approval and replay, concurrency, permissions, invalid hours, recorded attendance and payroll locks. Chrome checks exercised real local D1 saves at widths 320, 390, 768 and 1280 with no overflow or page errors. Local credentials are fake and notifications are disabled. Production build and Wrangler dry run passed.

Private pre-release backup: `backups/schedule-edit-20261010-065414/database.sql`, 111088 bytes, SHA256 `8A9C5767F93A5A71B97E57E1F0925303CBFD72251BBA8FE7F024D462A6F0BEC9`. Pre-migration counts: four users, three employees, three attendance sessions, thirteen weekly rules, five applied migrations; foreign-key check returned no violations.

`npm run check` passed all 179 tests and the production TypeScript/Vite build. Migration 0006 was applied remotely; all nine new triggers are present, six migrations are recorded, aggregate business-record counts are unchanged and the foreign-key check is clean.

Deployed to `https://staff-attendance-api.voxid-mr.workers.dev`, Worker version `17c5e816-f318-4dfa-ba66-28dab06c6518`, frontend bundle `/assets/index-CIzb05Jt.js`. Live production and security checks passed: current frontend/assets, D1 health, access boundaries, reception PWA assets, Telegram authentication rejection, origin enforcement and webhook-secret validation. These checks created no business records or messages. Device checks in real Telegram and on the Samsung Tab A9 remain pending with the owner.
