# Existing Cloudflare configuration

Wrangler now targets these owner-provided resources:

| Setting                          | Value                                               |
| -------------------------------- | --------------------------------------------------- |
| Worker                           | `staff-attendance-api`                              |
| App origin / future Mini App URL | `https://staff-attendance-api.voxid-mr.workers.dev` |
| D1 database                      | `staff-attendance-db`                               |
| D1 binding                       | `DB`                                                |
| D1 ID                            | `0d6fc486-37ad-4639-a199-00f92e765778`              |

The existing resources now host Phase 2. After explicit owner approval, the production database was inspected, the foundation migration applied, and the application deployed. No new Worker or database was created. Logging is enabled and preview URLs are disabled explicitly in Wrangler, matching the prior dashboard preferences. The application retains its tested compatibility date. See the [release record](PRODUCTION_RELEASE.md).

After the owner's explicit approval, `TELEGRAM_BOT_TOKEN` and `BOOTSTRAP_TELEGRAM_ID` were uploaded as encrypted secrets to the existing `staff-attendance-api` Worker. The owner chose the originally supplied bot token. Secret values were supplied through hidden stdin, without adding them to source files or command arguments. Cloudflare sign-in credentials are stored encrypted with a key in Windows Credential Manager. The separately approved database migration and application deployment are now complete; both secrets were confirmed present after deployment.

## Phase 2 release status

Phase 2 is built, tested and deployed after owner approval. `0002_attendance.sql` has been applied remotely; post-release verification found no pending migrations or foreign-key errors. See [the Phase 2 release record](PRODUCTION_RELEASE_PHASE2.md). No new Worker secrets are required. See [the Phase 2 report](PHASE_2.md). The production statements below describing no pending migrations refer to the completed Phase 1 release, before Phase 2 existed.

## Migration readiness and commands

`database/migrations/0001_foundation.sql` creates the Phase 1 identity, employee, role/level, historical assignment/rate, permission, session, audit/idempotency, rate-limit, and settings tables. It seeds four role names and system defaults, with no users, credentials, or sample wages. Disposable local D1 integration tests verify this schema.

Run locally from this project directory:

```powershell
npx wrangler d1 migrations list DB --local
npm run db:migrate
# Equivalent to the npm command:
npx wrangler d1 migrations apply DB --local
```

`--local` uses development storage under `.wrangler/state` and does not change production. The new configured database ID can select a different local database from the previous placeholder ID. Apply the local migration before starting development; earlier synthetic local records are not automatically copied.

The owner authorized future deployments and necessary migrations on 10 October 2026 without another approval question. Inspect pending migrations and take a private backup before a production migration:

```powershell
npx wrangler login
npx wrangler d1 migrations list staff-attendance-db --remote
# After schema inspection and a private backup:
npx wrangler d1 migrations apply staff-attendance-db --remote
```

The database name targets your existing database. Do not run `wrangler d1 create`. The first migration expects its application tables not to exist. Production inspection found only Cloudflare/migration metadata tables, so `0001_foundation.sql` was successfully applied. Wrangler reported no pending migrations at the Phase 1 release. Phase 2 was subsequently applied after separate approval. Do not edit migrations after application.

## Telegram integration

Phase 1 implements Mini App authentication: the backend verifies signed Telegram `initData` using the bot token, rejects expired/replayed logins, checks registration, and creates an HttpOnly session. The frontend loads the official Telegram Web App SDK. Your newly created bot must be the same bot whose token verifies these logins.

Required Worker secrets:

| Secret                  | Value                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`    | Your new bot's BotFather-issued token.                                                                      |
| `BOOTSTRAP_TELEGRAM_ID` | Your personal numeric Telegram user ID for the initial super administrator; not the bot's ID or a username. |

The two secrets are now configured. For a future authorized replacement, add encrypted secrets through the existing Worker's Cloudflare settings or these interactive commands. They write to Cloudflare and publish a new version of its current code:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put BOOTSTRAP_TELEGRAM_ID
```

Enter values at the prompt, not in source or command arguments. Keep the token out of frontend code and chat. Remove the bootstrap secret after the initial administrator has been verified; its singleton database marker prevents subsequent bootstrap creation. `APP_ENV=production` and `APP_ORIGIN` are already configured as nonsecret variables. D1 uses the `DB` binding, so the application needs no D1 password/API-key secret.

The production migration and deployment are complete. Configure the bot's Main Mini App or menu button in @BotFather with:

```text
https://staff-attendance-api.voxid-mr.workers.dev
```

Creating the bot alone does not connect it to this application. The approved Phase 3 release now provides `/start`, `/stop`, secret-verified webhooks and queued notifications. `TELEGRAM_WEBHOOK_SECRET` is configured alongside the existing secrets, and the live webhook is verified. See [the Phase 3 release record](PRODUCTION_RELEASE_PHASE3.md). Send `/start` to `@izamirtemurbot` to permit delivery. Real message delivery and device flows still need owner verification.

## Verification

```powershell
npm run check
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

The first command runs disposable local tests, TypeScript checking, and the frontend build. The second only bundles the Worker locally and does not deploy. Neither modifies production D1. An actual deployment would replace the code/assets currently hosted by the existing Worker and is covered by the owner's standing release authorization.

The pre-release foundation suite passed all 42 tests; a fresh TypeScript check and frontend build passed before deployment. Live verification passed for frontend/assets, HTTPS/security headers, D1 health, private-route protection, and invalid login rejection. The production database has no foreign-key errors or pending migrations. No synthetic employees or administrator sessions were created. Local migration storage remains separate from production. Run `node scripts/verify-production.mjs` to check the current tested Phase 6 build; one invalid login increments a normal rate-limit counter but creates no user/session.

References: [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Telegram Mini Apps](https://core.telegram.org/bots/webapps).

## Current Phase 6 release

The current setup and deployment commands are in [the release runbook](RELEASE_RUNBOOK.md). Phase 6 reuses the existing five migrations, three encrypted secrets, Worker, D1, webhook and notification cron. It adds full-schema health checks and protected private error headers without a new migration. Follow [device checks](DEVICE_CHECKS.md) for the remaining physical Telegram and Tab A9 acceptance. Earlier release sections above preserve historical results.
