## Current production workflow

Salary figures are separated into calendar months. This ERP does not manage payments; new advance adjustments are rejected. Employees see their own provisional or finalized month under My salary. Bonuses, deductions, fines and manually approved leave pay remain calculation inputs.

QR tokens expire after 60 seconds. Both employee check-in and checkout require a current scan from a registered reception display. Paired displays have no server-side expiry and remain valid until revoked; active reception use refreshes the secure cookie. Clearing cookies still requires pairing. After this release, reopen the Telegram Mini App and refresh each reception display to load the new scanner and QR policy.

Daily schedule corrections are available for recorded and past days, with an attendance-time preview and immutable before/after history. Finalized salary periods must be reopened first. Original attendance times are preserved. The weekly calendar shows shifts, approved absences and coverage. Pending uniform declarations can be amended; reviewed declarations require an administrator to return the decision to pending.

Employee cards in the admin queue show outstanding work and links to its decision screen. Audit summaries describe changes in plain language; full records remain expandable.

# Configuration and operations

Reasons and review comments are optional throughout the application as of 2026-10-10. Blank and short notes are accepted, with a 1,000-character limit. Audit logs still record the actor, timestamp and change; permissions, payroll locks and review approvals still apply. Earlier phase documents describe the original required-reason behavior.

Employees choose whether they have a uniform in My attendance after check-in. Both choices require administrator review; “no uniform” does not automatically impose a fine. Daily reviews, Requests and Payroll group records within employee cards. In Monthly salaries, each employee has a separate salary card. Expand Salary breakdown for planned versus recorded times and Review tasks for decisions. Review next task guides the administrator through outstanding decisions for that employee. The Finalize month panel explains remaining blockers.

## Environment

The 11 October shift-message release adds 30-minute start and 10-minute end reminders, independent encouragement preferences and warm sick-leave approval messages. Existing reminder opt-outs remain respected. It also adds dated role-specific daily extended-hours replacement rates, configured under Roles & rates. No rate is enabled by default. See [administrator instructions](ADMIN_GUIDE.md) and [release details](RELEASE_SHIFT_MESSAGES_DAILY_PAY.md). No additional Cloudflare secrets are required.

| Value                   | Local                                              | Production                                                    |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `APP_ENV`               | `development` in ignored `.dev.vars`               | `production` in Wrangler vars                                 |
| `APP_ORIGIN`            | `http://127.0.0.1:5173`                            | `https://staff.eshtaylakov.uz`                                |
| `TELEGRAM_BOT_TOKEN`    | Fake token from example, or actual test bot secret | Worker secret only                                            |
| `BOOTSTRAP_TELEGRAM_ID` | `100001` for synthetic login                       | Intended owner's numeric Telegram user ID, stored as a secret |
| D1 `database_id`        | Isolated local storage for configured ID           | `0d6fc486-37ad-4639-a199-00f92e765778`                        |

No frontend secret or `VITE_` credential is required. `.dev.vars`, runtime database files, dependency caches, and backups are ignored. Keep the initial owner's Telegram ID verified through a trusted channel. Remove the bootstrap secret after the initial administrator has been verified; the database marker prevents later bootstrap reuse regardless.

For real local Telegram verification, use a test bot, place its token in `.dev.vars`, set the intended bootstrap ID, and use an approved HTTPS development URL for the Mini App with an exact matching `APP_ORIGIN`. The synthetic login utility deliberately refuses to sign with a real bot token.

## First administrator workflow

Configure role levels with approved wages and effective dates. Register each employee's numeric Telegram ID obtained directly from that employee; their first signed login must match it. Assign a level with a rate effective on their activation date. Employee usernames are not stable identifiers. Employee onboarding is direct registration in Phase 1; invite links are not implemented.

Admin access is granted by the super administrator after onboarding. Give only required permissions. `salary.manage` enables catalog editing, wage changes, assignment changes, and rate history. `employees.manage` enables basic onboarding and employee lifecycle management. Both are needed to change an existing employee's level. A manager without wage permission can onboard into an existing approved level, but cannot set wages. `payroll.approve` grants explicit financial decisions, payroll finalization and audited reopening. Salary editors can propose adjustments; attendance-only administrators cannot view company payroll. Non-super administrators cannot edit an administrator account. Telegram relinking requires a super administrator; the audit records the change and an optional reason.

Use future-dated rates rather than rewriting the current date. Unintended same-day rates require a reviewed correction process, not manual deletion of history. Historical effective-date editing is deferred. Deactivation revokes sessions immediately; reactivation clears the deactivation date. Phase 1 does not model multiple rehire periods, so avoid using reactivation as a substitute for a future employment-history workflow.

## Production preparation

On 10 October 2026, the owner authorized future deployments and necessary migrations without a separate approval question. This supersedes the earlier per-release approval instructions. The project has no automatic CI deployment; before a release:

1. Review the full phase reports and remaining security/device verification requirements.
2. Use the existing `staff-attendance-api` Worker and `staff-attendance-db` database configured in Wrangler. Inspect the existing schema before any approved remote migration. Do not create replacement resources. See [Cloudflare setup](CLOUDFLARE_SETUP.md).
3. Set the correct HTTPS origin and Worker secrets. Remove all fake local credentials from production configuration.
4. Run tests/build, back up an existing database if any, and inspect pending migrations.
5. Apply the inspected migrations and deploy the tested Worker/static assets under the owner's standing authorization. Record backup and release verification results.
6. Configure the bot's main Mini App/menu URL in @BotFather and verify the intended bootstrap identity. Test both admin and employee logins on actual Telegram clients.

The existing bot webhook and notification cron are active. Preserve their configured secrets and Mini App URL; Phase 4/5 reuse them.

## Backup and restore

Local rehearsal, exporting only the development database:

```powershell
New-Item -ItemType Directory -Force backups
npx wrangler d1 export DB --local --output backups/local-foundation.sql
```

For a future approved production operation, use D1 export with `--remote` to an access-controlled location. Backups contain private employee IDs, salary rates, audit records, and session hashes. Protect them, restrict access, and retain them according to the center's policy. Do not commit or share exports publicly. Cloudflare's documented [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is an additional recovery option, not a replacement for tested exports.

Rehearse restore into a **new empty database**, never over the only live copy:

```powershell
npx wrangler d1 execute DB --local --file backups/local-foundation.sql
```

That command is for a local empty target after pointing Wrangler at an isolated restore configuration; it is not safe against a populated target. Preserve the original export, verify table counts and foreign keys, revoke restored `auth_sessions`, and validate accounts/rates before switching any production binding. Wrangler exports include migration bookkeeping when present; check it before applying further migrations. No restore has been executed against live data.

## Availability and cost

The architecture uses Worker requests, static assets, and D1 only. It has no paid service dependency. Free tiers have finite request/CPU/database limits, and may fail requests when quotas are reached. Monitor Workers/D1 dashboards and query rows read/written before rollout. Authentication/write rate limiting costs database writes; protected reads also check identity and permissions. At this team size that is simple and predictable, but future tablet polling/reminders must remain bounded.

Check current limits at release time: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). No paid plan is provisioned and no free-tier availability guarantee is made.

During an outage, keep a manager-controlled paper record. Employees submit attendance corrections after service returns; administrators confirm the actual times with evidence, a reason and audit. Offline check-in is not queued or reported as successful.

API errors are concise and avoid secrets. Authentication/session/audit data is never cached in a service worker or browser storage. Session cookies need actual Android and Telegram Web/Desktop verification before production use. Reception PWA pairing and kiosk setup are documented in [Phase 2](PHASE_2.md). Cron reminders and payroll exports are implemented. Dark theme and external monitoring automation remain deferred.

## Phase 2 attendance operation

Grant `attendance.manage` to administrators who configure schedules, inspect live attendance, approve overtime intervals, or confirm forgotten departures. Only super administrators register/revoke reception displays. Paired tablets can fetch signed QR codes but cannot read employees, salaries, or attendance.

See [Phase 2](PHASE_2.md) for calculation rules, pairing, installation, expiry, offline handling, testing limits and rollout steps. Early departures have explicit daily review decisions. Unapproved overtime requires approval or an explicit payroll resolution before finalization. Open sessions earn no estimated pay; administrators confirm the actual departure with a reason. Revocation immediately prevents new QR issuance and check-in with that display.

## Phase 6 operations

Use the current [administrator guide](ADMIN_GUIDE.md), [device setup/checklist](DEVICE_CHECKS.md), and [release/backup/recovery runbook](RELEASE_RUNBOOK.md). Physical device tests remain pending; bundled Chrome reception/offline and automated business/security checks passed. The new backup/restore helpers protect exports with owner-only Windows ACLs and rehearse restores only into newly created private local storage. No production restore or automated external backup transfer is configured.
