# ATBOT

The latest review workflow groups decisions by employee and workday, separates Pending from History, and fixes split-shift review inconsistencies. See [the review inbox release](docs/RELEASE_REVIEW_INBOX.md) and [current administrator guide](docs/ADMIN_GUIDE.md). Intended paid-start rounding and monthly fine progression are preserved.

Telegram attendance and payroll workspace for **IELTS ZONE**. Phases 1?5 are implemented and deployed; Phase 6 adds release/security verification and operating guides. Physical Telegram/Tab A9 checks remain pending at the owner's request. Production uses the existing Worker and D1 at https://staff-attendance-api.voxid-mr.workers.dev. See [Phase 4](docs/PHASE_4.md), [Phase 5 payroll workflow](docs/PHASE_5.md), and [the release record](docs/PRODUCTION_RELEASE_PHASE5.md). The owner has authorized future deployments and necessary migrations without a separate approval question.

## Run locally (PowerShell)

Install Node.js 22.12 or newer and npm. From this directory:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run build
npm run db:migrate
npm run dev
```

Open **http://127.0.0.1:5173**. The frontend proxies `/api` to the Worker at port 8787. Use exactly that hostname; `localhost` is a different origin. The two processes run together and stop with Ctrl+C. Local D1 files live under `.wrangler/state`; they are independent of Cloudflare production data.

In a second terminal:

```powershell
npm run test:login
```

Expand **Local development sign-in**, paste the generated string, and continue. It is valid for five minutes and can be used once. The fake local bot token is checked using the real Telegram verification algorithm; there is no authentication bypass in the Worker. The test-login field is excluded from production builds. Do not use these fake credentials outside local development.

The first local login creates the super administrator for Telegram ID `100001`. Then:

1. Open **Roles & rates** and add a level and integer hourly rate to a role. Example wages are deliberately not seeded.
2. Open **Employees**, add an employee's verified numeric Telegram ID, level, and activation date.
3. For testing that employee locally, run `npm run test:login -- 200001` (use the ID you registered).
4. Use **Admin access** to promote an employee account and grant specific permissions. Granting or revoking access invalidates their existing sessions.

If restarting an app after signing out, generate new initData. Reusing consumed login data returns a clear error. To preview the production frontend locally, `npm run build` then `npm run preview`; configure `.dev.vars` `APP_ORIGIN=http://127.0.0.1:8787` for mutations on that port. The production frontend contains no local login form, so use the Vite development frontend for synthetic logins.

## Attendance and reception

Cashiers, administrators and super administrators can use **Debtors & cashier bonus** to enter shared daily debtor counts. The latest percentage updates the current month's cashier bonus; cashiers see only their own salary. See [cashier setup, multiplier rules and payroll behavior](docs/CASHIER_BONUS.md).

After onboarding, use **Schedules** to configure weekly hours or a one-day override. Saved recurring rules have an **Edit weekly schedule** action; individual shifts have **Edit this day** for exceptions, cancellation/restoration and extra-shift approval. Changes require a reason and protect recorded attendance and locked payroll. See [the administrator guide](docs/ADMIN_GUIDE.md) and [schedule editing release](docs/RELEASE_SCHEDULE_EDITS.md). The super administrator can open **Reception displays**, register a tablet, and copy its five-minute pairing code into `/reception/`. Employees use **My attendance** to scan the current QR and check out. Actual time and credited regular time are shown separately; salary amounts are estimates. See [the Phase 2 setup guide](docs/PHASE_2.md) for Android installation and remaining device checks.

With local development running, `node scripts/smoke-phase2.mjs` rehearses the full HTTP flow using fake credentials and clearly marked local records. It disables the test employee/level and revokes its display afterward. No remote data is used.

Schedules support an optional second regular shift in weekly rules and one-day overrides. Each shift can be edited or cancelled separately; breaks are excluded from regular pay, including when an attendance session spans both windows. At 23:00 Asia/Tashkent, the minute cron closes remaining attendance at that timestamp, independently of notification settings. New check-ins resume the next day. Automatic closes have an immutable `automatic_checkouts` journal and remain correctable through the existing attendance correction workflow. Administrators can also record a missing uniform choice and complete its review directly; their observation is stored separately from employee declarations.

## Verify

```powershell
npm run check
```

Unit tests verify Telegram HMAC, expiry, input validation, permission separation, and Tashkent dates. Integration tests use actual Miniflare D1, apply all versioned SQL migrations, and exercise authentication, replay prevention, onboarding, isolation, atomic/idempotent writes, wage history, account revocation/relinking, admin authorization, auditing, and rate limiting. Attendance tests also cover salary examples, QR expiry/revocation, schedule overrides, concurrent check-in/out and idempotent retries. Phase 3 tests cover request isolation, concurrent decisions, correction snapshots/recalculation, stale/overlapping attendance, payroll locks, coverage acceptance/overlap, webhook secrets, and mocked notification retries. Phase 4/5 tests cover daily reviews and monthly progression, explicit financial approval, manual paid leave, historical rates, immutable snapshots/locks, reopening, CSV protection and employee privacy. The suite also covers shared review-task counts, pending/history separation, split-shift review consistency, private error headers and full-schema readiness checks. No Telegram or Cloudflare account is needed. Tests use disposable databases, never `.wrangler/state` or a remote database.

## Repository

- `frontend/`: React, TypeScript, Tailwind, central English text, admin and employee views.
- `backend/`: Hono Worker, Telegram verification, D1 access, security and permission enforcement.
- `shared/`: pure domain helpers, permissions, validation; integer interval and historical gross-earnings calculations.
- `database/migrations/`: versioned D1 schema and four initial role names.
- `tests/`: unit and real local D1 integration tests.
- `scripts/`: local process runner and synthetic signed test login.
- `docs/`: architecture, implementation plan, configuration, operations, and phase report.

See [architecture and plan](docs/ARCHITECTURE.md), [configuration and operations](docs/OPERATIONS.md), [Phase 1 report](docs/PHASE_1.md), and [Phase 2 report](docs/PHASE_2.md).

## Cloudflare configuration

Wrangler targets the existing Worker `staff-attendance-api` and D1 database `staff-attendance-db` (binding `DB`, ID `0d6fc486-37ad-4639-a199-00f92e765778`). The production origin is `https://staff-attendance-api.voxid-mr.workers.dev`. All other settings are preserved. Do not create another Worker or database. Local changes reach the live Worker only through an explicit deployment command.

`TELEGRAM_BOT_TOKEN`, `BOOTSTRAP_TELEGRAM_ID`, and `TELEGRAM_WEBHOOK_SECRET` are configured as encrypted Worker secrets. Notification delivery is enabled in production and disabled in local fake-credential configuration. The foundation migration and Phase 1 deployment were completed after explicit owner approval. Never copy `.dev.vars` into production. See [Cloudflare setup and migration commands](docs/CLOUDFLARE_SETUP.md). The owner granted standing authorization for future deployments and necessary migrations; inspect migrations and take a private backup before release.

Use @BotFather to configure the bot's main Mini App/menu button with the HTTPS app URL. Both employee and admin views use the same verified Telegram Mini App login. Standalone desktop Telegram login, Bot API webhooks and notifications are active in Phase 3. Send `/start` to the bot to permit delivery. Read [Telegram's validation specification](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) and [Cloudflare's local D1 documentation](https://developers.cloudflare.com/d1/best-practices/local-development/).

## Release verification and operating guides

- [Phase 6 status and evidence](docs/PHASE_6.md)
- [Administrator guide](docs/ADMIN_GUIDE.md)
- [Telegram / Samsung Tab A9 setup and pending checks](docs/DEVICE_CHECKS.md)
- [Deployment, private backup and restore runbook](docs/RELEASE_RUNBOOK.md)

Run `node scripts/verify-release-config.mjs` after building, then the production and security verification scripts after deployment. See the runbook for owner-only backup and isolated local restore helpers.
