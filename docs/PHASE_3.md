# Phase 3: employee requests

Implemented, tested and deployed on 10 October 2026 after explicit owner approval. **Production now runs Phase 3**, including the existing account-isolation fix. See [the Phase 3 release record](PRODUCTION_RELEASE_PHASE3.md). This phase adds one migration to the existing D1 database; it creates no new Worker or database.

## Employee experience

- **My attendance** retains check-in/out, today's timer, upcoming shifts, credited time and the historical-rate gross salary estimate. A date selector opens previous payroll periods.
- A prominent **I Can't Come Today** action opens the absence form. Sick leave, personal matter, emergency and other categories support optional explanations, future dates, and audited late submissions during employment. Requests remain pending until an administrator decides; no absence creates worked time or automatic fines.
- Attendance corrections support missing check-in/out, unavailable QR, and incorrect timestamps. Employees provide the complete correct arrival/departure interval and a reason. Existing records retain their first original snapshot and an audit trail for each decision. Missing sessions become separate approved manual attendance, without pretending a tablet scan occurred.
- Overtime requests specify a workday, interval and reason. Approved intervals only credit actual closed attendance outside regular hours; overlapping intervals do not double-pay.
- Employees see their most recent 100 requests and coverage assignments, decision explanations, and coverage acceptance/decline controls. The API also provides date-bounded history, effective attendance and original snapshots.
- Notification preferences enable attendance/request messages and optional upcoming-shift reminders. Employees must start the bot chat to allow delivery.

## Administrator experience

The **Requests** screen requires `attendance.manage`. It shows pending/approved/rejected requests, submitted intervals and original timestamps before review. Every decision requires a reason and records the deciding user/time. Ordinary employees cannot review another employee's requests or assign coverage. Admins without attendance permission cannot review requests.

Only the super administrator can authorize a paid absence category. All categories initially default to unpaid. Each approval snapshots its current paid policy, so later policy changes do not rewrite earlier decisions. **Paid leave is recorded separately; the worked-time estimate does not include leave pay. Final leave-pay amounts, adjustments and payroll settlement belong to Phase 5.**

Approved absences appear separately in live attendance. Coverage assignments refer to the original absence and a different employee. Coverage requires explicit overtime approval and can require employee acceptance. Accepted assignments appear as extra shifts in the replacement employee's schedule. Pending/declined coverage does not create a shift. Overlapping scheduled shifts, inactive or absent replacements, and self-coverage are rejected. Declined coverage can be reassigned.

## Integrity and notifications

Business changes, audit entries, deduplicated notification events and idempotency results commit together. Concurrent approvals cannot both succeed. Corrections reject changed underlying attendance and overlapping effective sessions; manually approved attendance also protects historical schedule snapshots. Corrections immediately recalculate existing attendance, lateness/early-departure summaries and gross estimates. Disciplinary decisions remain Phase 4.

`payroll_period_locks` provides a guard for Phase 5: approvals affecting a locked period require an adjustment workflow instead of changing historical attendance. There is intentionally no Phase 3 endpoint for creating/reopening final payroll locks.

The webhook at `/api/telegram/webhook` accepts private `/start` and `/stop` commands only after verifying the secret header. It does not accept a browser cookie as webhook authorization. Registered active users are matched to the Telegram sender; unknown accounts gain no access. Duplicate webhook replies and business events are deduplicated. Old webhook updates cannot reverse newer command state.

Notifications cover check-in/out, request submission/decisions, coverage assignment/decision, forgotten checkout, and opt-in reminders within 15 minutes of shift start. A one-minute Worker cron prepares events and drains at most ten messages per run. No paid queue service is used. Delivery checks the current Telegram link, enabled state and administrator permission, including for queued messages after relinking/demotion.

Known Telegram rate-limit/server failures retry with bounded backoff. Permanent failures stop. Because Telegram has no send-message idempotency key, network timeouts/interrupted sends are marked `uncertain` and are not automatically resent; this favors avoiding duplicates over guaranteed delivery. Expired events are skipped and completed/failed/uncertain events are pruned after 30 days, except forgotten-checkout and webhook entries retained to prevent replayed reminders or replies. Audit and request history are preserved. Attendance does not wait for Telegram delivery.

## Local validation

```powershell
npm run check
npx wrangler d1 migrations apply DB --local
npx wrangler deploy --dry-run --outdir .wrangler/phase3-dry-run
```

Tests use disposable Miniflare D1 databases and mock all Telegram delivery. They never modify production or message real users. Migration `0003_employee_requests.sql` also rehearsed successfully through Wrangler against local D1. The earlier deployed migrations are unchanged.

**Validation result:** 118 tests passed in the full regression run, followed by 36 passing attendance/request checks including three added regressions (121 distinct tests total). Final TypeScript and Vite build passed; Wrangler local migration (29 commands) and Worker deployment dry run passed. The actual bundled local Worker also passed HTTP checks for Phase 3 D1 health, private-route protection, webhook secret enforcement, the disabled scheduled handler, and frontend delivery.

Real Telegram notifications, mobile UI/scanner behavior and end-to-end employee/admin flows still need device verification after an approved release. Local backend/build checks do not establish that these device checks have passed.

## Production release checklist вЂ” owner approval required

1. Obtain explicit approval for the migration, existing Worker deployment, webhook configuration and enabling notifications. Prior-phase approval does not authorize this phase.
2. Export the current remote D1 to a private backup and verify its checksum. Inspect current records and pending migrations; do not assume the database is empty.
3. Apply only the pending `0003_employee_requests.sql` migration:

   ```powershell
   npx wrangler d1 migrations list DB --remote
   npx wrangler d1 migrations apply DB --remote
   ```

4. Generate a random 64-character hex `TELEGRAM_WEBHOOK_SECRET` and upload it with `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, using stdin without printing the value. Keep the existing `TELEGRAM_BOT_TOKEN` and bootstrap secret.
5. Deploy the tested build with notification delivery still disabled. Then configure Telegram `setWebhook` with the existing bot token, URL `https://staff-attendance-api.voxid-mr.workers.dev/api/telegram/webhook`, the matching `secret_token`, and `allowed_updates=["message"]`. Do not put the token in a command-line argument or print request URLs/errors containing it. Inspect `getWebhookInfo` without exposing credentials.
6. Set `NOTIFICATIONS_ENABLED` to `true` and deploy the existing Worker after webhook verification. The approved release now sets this flag **true** in Wrangler; local `.dev.vars` keeps it **false** with fake credentials.
7. Run `node scripts/verify-production.mjs` only after the Phase 3 release: it expects Phase 3 health and the new build hash. Have the owner and a registered employee start the bot and exercise requests, decisions and delivery on their own Telegram accounts.

Required secrets: existing `TELEGRAM_BOT_TOKEN`, existing `BOOTSTRAP_TELEGRAM_ID`, and new `TELEGRAM_WEBHOOK_SECRET`. Delivery control is an ordinary variable, not a secret. Never copy the fake `.dev.vars` credentials into production.

Webhook secret parameters and private-chat web-app buttons follow [Telegram's Bot API](https://core.telegram.org/bots/api#setwebhook). The scheduled handler and `triggers.crons` configuration follow [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
