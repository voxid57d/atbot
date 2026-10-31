# Database migrations

Apply `database/migrations` through `npm run db:migrate` (always local). Wrangler records successful migrations and will not apply them twice. Never edit an applied migration; introduce another numbered file. Production migrations must be explicitly approved.

`0001_foundation.sql` creates only Phase 1 entities, inserts system defaults and four role names, and intentionally seeds no users or wages. Bootstrap creates its user after a verified login. D1 enables foreign keys; the migration also specifies them explicitly.

Employee/rate assignment lookup indexes cover effective-dated histories. Unique constraints protect Telegram links, employee profiles, per-date history, bootstrap, login replay, permission grants, and idempotency. No destructive delete endpoints exist for business records.

Times on events/authentication are UTC integer Unix seconds. Effective and employment dates are ISO calendar dates in Asia/Tashkent. Rates are integer UZS. `0002_attendance.sql` adds scheduled shifts and actual sessions separately, registered reception displays, overtime approvals, and atomic transition/protection constraints; Phase 5 will add period locks, calculation records, and snapshots.

Phase 2 migration was applied locally and is covered by disposable D1 integration tests. It was subsequently applied remotely after explicit owner approval; see [the release record](../docs/PRODUCTION_RELEASE_PHASE2.md). Never change `0001_foundation.sql`, which is already deployed.
