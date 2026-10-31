# Phase 3 production release

Released on 10 October 2026 after the owner's explicit approval to apply the migration, deploy the existing Worker, configure the webhook and enable Telegram notifications.

- Worker: `staff-attendance-api`
- App: https://staff-attendance-api.voxid-mr.workers.dev
- D1: `staff-attendance-db`, binding `DB`, database ID `0d6fc486-37ad-4639-a199-00f92e765778`
- Final active version: `b070b654-e06c-4a8f-ae95-4a54b8825efd`
- Initial Phase 3 version with delivery disabled: `3f8f0275-f9b2-41cd-820e-e13ba9230318`
- Bot: `@izamirtemurbot`
- Webhook: `https://staff-attendance-api.voxid-mr.workers.dev/api/telegram/webhook`
- Notification delivery: enabled; cron `* * * * *`.

No new Worker or database was created. The original bot token and bootstrap secret were retained. A random webhook secret was uploaded as `TELEGRAM_WEBHOOK_SECRET`. A Windows DPAPI encrypted recovery copy is in the ignored `.wrangler/phase3-private` directory, restricted to the current Windows owner. Secret values are not in this report or application source.

## Backup and database

The private pre-release backup is `backups/phase3-release-20261010/pre-phase3.sql` (18,556 bytes), with directory/file access restricted to the current Windows owner. It is ignored by source control and must not be shared.

SHA-256: `3F3FC60375F8335D5AC8EF0880D90A600CFC8551C42070BBC8EBDF429AACFB83`.

Before migration, production contained two users, one employee, one hourly-rate record, one attendance session and one registered tablet. There were no foreign-key violations. Only `0003_employee_requests.sql` was pending.

The migration applied all 29 commands successfully. Post-migration checks confirmed all three migrations, no pending migrations, no foreign-key violations, and preservation of the existing record counts. New request/manual-attendance tables were empty. An initial aggregate verification query exceeded D1's compound SELECT limit; it was replaced with equivalent read-only scalar subqueries and completed successfully. No synthetic production employee, session, request or attendance record was created.

## Deployment and webhook verification

The tested build was first deployed with notification delivery disabled. Telegram `getMe` confirmed the existing bot identity. `setWebhook` configured the HTTPS endpoint with the matching secret, private message updates and ten maximum connections; pending updates were preserved.

`getWebhookInfo` confirmed the expected URL, allowed updates `["message"]`, zero pending updates and no reported error. A valid-secret empty update returned success from the live Worker without creating an account or message. Only after these checks was `NOTIFICATIONS_ENABLED=true` deployed. Wrangler confirmed the one-minute cron and final active version. Local `.dev.vars` explicitly keeps notifications disabled with fake credentials.

All three secret names were confirmed after the final deployment: `TELEGRAM_BOT_TOKEN`, `BOOTSTRAP_TELEGRAM_ID`, `TELEGRAM_WEBHOOK_SECRET`. Their values were not read back or printed.

## Validation

Pre-release checks covered 121 distinct passing tests, the TypeScript/Vite build, the local migration, actual bundled local HTTP routing, and Worker dry-run bundling. See [the Phase 3 implementation report](PHASE_3.md).

Live verification passed after both deployments for current frontend assets, CSP/HSTS, Phase 3 D1 health, protected attendance/request/admin/preferences routes, reception PWA assets and invalid-login rejection. Each deliberately invalid login only increments the normal rate-limit counter and creates no account/session.

Webhook configuration and authentication are verified. Real message delivery, native Telegram/browser UI, employee approval flows and tablet camera behavior still require checks on the owner's devices. No direct test message was sent by the release tooling.

## Owner steps

1. Open `@izamirtemurbot` and send `/start` so Telegram permits bot messages.
2. Close and reopen the Mini App to load Phase 3.
3. Employees use **My attendance** for absence, correction and overtime requests and coverage acceptance. Administrators with attendance permission use **Requests** for decisions and coverage assignment.
4. Confirm a real request/decision on the intended employee/admin accounts. Notifications are processed once per minute; allow time for delivery.
5. Enable upcoming-shift reminders in notification preferences when wanted. All absence categories default to unpaid; only the super administrator can authorize a paid policy.

Salary figures remain worked-time estimates. Paid leave settlement, payroll adjustments/finalization and disciplinary decisions remain later phases.
