# Phase 1 production release

Historical record. Phase 2 was subsequently released; see [the current release record](PRODUCTION_RELEASE_PHASE2.md).

Released 10 October 2026 (Asia/Tashkent), after explicit owner approval for the production migration and application deployment.

- Existing Worker: `staff-attendance-api`.
- URL: https://staff-attendance-api.voxid-mr.workers.dev
- Existing D1: `staff-attendance-db`, ID `0d6fc486-37ad-4639-a199-00f92e765778`, binding `DB`.
- Migration: `0001_foundation.sql`, successfully applied remotely (22 SQL statements).
- Final deployed version: `eed34ece-9c8d-4887-b665-fc3b06ab3be0`.
- New Worker/database creation: none.
- Encrypted secrets preserved: `TELEGRAM_BOT_TOKEN`, `BOOTSTRAP_TELEGRAM_ID`.
- Logging enabled; preview URLs disabled in tracked Wrangler configuration. The application retains its tested compatibility date, `2026-10-06`.

Before migration, inspection found only Cloudflare/migration metadata tables, with no application tables or employee/payroll data. The migration introduced foundation tables and initial role names/settings. No employee, wage, payroll, or synthetic administrator was inserted. Production `PRAGMA foreign_key_check` returned no errors, and Wrangler reports no pending migrations.

## Validation

The pre-release foundation suite passed all 42 tests. A fresh TypeScript check and frontend production build passed before deployment. Live HTTP verification passed for application HTML, JS/CSS assets, Content Security Policy and HTTPS headers, D1 health, unauthenticated private-route denial with no-store headers, and rejection of invalid Telegram login data. Both secret names remain present after deployment.

Repeat live checks with `node scripts/verify-production.mjs`. This checks public assets/private access boundaries and submits one invalid login; it does not create an account or session, but increments the normal authentication rate-limit counter. Actual Telegram owner login and mobile/browser visual verification remain user/device checks, not claimed as completed.

## Owner's next action

1. In @BotFather, select the existing bot and set its Main Mini App or menu button URL to `https://staff-attendance-api.voxid-mr.workers.dev`.
2. Open the Mini App from the bot inside Telegram and press **Continue with Telegram**. The configured owner's verified identity will bootstrap the initial super administrator once.
3. Configure approved role/level wages, then onboard employee Telegram accounts. Employees must be registered before they can sign in.

The super administrator bootstrap marker was empty when checked after release, ready for the owner's real Telegram login. No production login was forged or simulated.

The bot has no `/start` reply handler or webhook yet; use its configured Mini App/menu button. Attendance, reception QR, schedules, and pay calculations remain Phase 2 work. This release completes Phase 1 deployment; no later phase was started.
