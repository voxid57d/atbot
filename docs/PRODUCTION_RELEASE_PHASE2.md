# Phase 2 production release

The subsequent [Telegram account-session isolation fix](ACCOUNT_SESSION_FIX.md) is now live at version `dde2081d-05fd-4dee-9027-ec8b71e45bb5`. The original Phase 2 release record follows.

Released 10 October 2026 (Asia/Tashkent), after explicit owner approval for the production migration and deployment.

- Existing Worker: `staff-attendance-api`.
- App: https://staff-attendance-api.voxid-mr.workers.dev
- Reception PWA: https://staff-attendance-api.voxid-mr.workers.dev/reception/
- Existing D1: `staff-attendance-db`, binding `DB`, ID `0d6fc486-37ad-4639-a199-00f92e765778`.
- Applied migration: `0002_attendance.sql` (18 statements).
- Deployed version: `daaf2f47-2f1d-4887-94cb-9183b1af5173`.
- Existing encrypted secrets preserved: `TELEGRAM_BOT_TOKEN`, `BOOTSTRAP_TELEGRAM_ID`. No additional secrets, Worker, or database were created.
- Wrangler resource bindings, production origin, compatibility date, logging and disabled preview URLs were preserved.

## Backup and migration

Before migration, schema inspection confirmed only the Phase 1 migration, one existing account, no employees or wage records, and no foreign-key errors. A private production SQL backup was saved to ignored `backups/phase2-release-20261010/pre-phase2.sql`; directory/file permissions allow the current Windows owner only. Do not commit or share this backup.

Backup SHA-256: `E9A4B1EB906734CA80598D99CC353CE2FED143AEF24C951100F3E5EC9EC84F76`.

The first migration attempt returned `incomplete input: SQLITE_ERROR`. A subsequent schema/migration inspection confirmed no partial Phase 2 objects were created and the migration was not recorded. The still-pending migration was adjusted to LF line endings and equivalent `SELECT RAISE(...) WHERE ...` trigger statements, avoiding nested CASE/END parsing. All 17 attendance API tests then passed against fresh disposable D1 databases before the successful remote retry. `.gitattributes` preserves LF for SQL migrations. This addresses parsing patterns reported in the [Cloudflare SDK issue tracker](https://github.com/cloudflare/workers-sdk/issues/4727) and [Windows migration report](https://github.com/cloudflare/workers-sdk/issues/14991).

The production migration then completed successfully. Post-migration inspection confirmed both numbered migrations, all four protection triggers, no pending migrations, and no foreign-key violations. The existing account remained; employees, wage records, attendance sessions and reception display records remained empty. No synthetic production account or attendance was created.

## Verification

- Pre-release: 91 tests passed, TypeScript and production build passed, local HTTP attendance/PWA rehearsal passed, Wrangler dry-run passed.
- After the SQL compatibility adjustment: all 17 attendance API tests passed on freshly created isolated local D1 databases.
- Cloudflare deployment succeeded with a 16 ms Worker startup time.
- `node scripts/verify-production.mjs` passed live checks for frontend JS/CSS, CSP/HSTS, Phase 2 D1 health, private attendance/admin routes, tablet QR authentication, reception HTML, manifest, service worker, icon, and rejection of invalid Telegram login data.
- Existing secret names were confirmed after deployment; secret values were not changed.

Live verification does not impersonate the owner or create employee attendance. Its single deliberately invalid login increments the normal rate-limit counter without creating an account/session. Native Telegram scanner, camera fallback and Android installation/offline recovery still need real-device checks.

## Owner setup

1. Open the existing Mini App from the bot in Telegram. Its BotFather Main Mini App/menu URL remains `https://staff-attendance-api.voxid-mr.workers.dev`.
2. In **Roles & rates**, configure real role levels and approved wages; in **Employees**, register employee Telegram IDs and activation dates.
3. In **Schedules**, configure each employee's weekly shifts and any one-day overrides.
4. In **Reception displays**, register the reception tablet and copy its one-use pairing code.
5. On the tablet, open the reception URL in Chrome, enter the code within five minutes, and use **Install app / Add to Home screen** and **Full screen** as appropriate. Keep the display open; registration expires after 30 days.
6. An onboarded employee opens the Mini App in Telegram, chooses **My attendance**, scans the current reception QR, then checks out when leaving. Confirm one real check-in/out on the intended devices before normal use.

See [Phase 2 behavior and limits](PHASE_2.md). Salary figures are gross estimates; requests, Telegram reminders/notifications, disciplinary reviews and final payroll remain later phases. Phase 3 was not started by this release.
