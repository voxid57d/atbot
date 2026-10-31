# Shift messages and daily extended-hours rates - 11 October 2026

Application: https://staff.eshtaylakov.uz. Existing Worker `staff-attendance-api` and D1 database `staff-attendance-db`.

## Behavior

English messages provide a friendly start reminder 30 minutes before a scheduled shift, an end reminder 10 minutes before its scheduled end, and rotating encouragement during attended shifts. End reminders and encouragement require an open attendance session. One encouragement is scheduled for two-to-under-six-hour shifts, two for longer shifts; shorter shifts receive reminders only. Approved sick leave receives a warm recovery message in the existing decision event, avoiding a second duplicate decision notification. Check-in and checkout confirmations are friendlier too.

Worker notification settings separate overall messages, start/end reminders and encouragement. Existing reminder opt-outs remain in effect. Encouragement defaults on for enabled bot chats and can be switched off independently. Staff must start the bot and enable shift reminders to receive start/end reminders.

Shift messages use actual scheduled shifts, including coverage, and Tashkent time. Generation windows are bounded to two minutes after the intended time, so outages do not trigger late catch-up bursts. Outbox delivery rechecks expiration, unchanged shift times/status, approved absences, current attendance and preferences. Existing ambiguous-delivery handling and atomic claims remain in use.

Roles & rates now has an optional daily extended-hours replacement rate for each role. Thresholds count chronological payable regular time plus approved overtime, combine visits without counting gaps, and reset each day. Partial hours use exact seconds and monthly UZS rounding remains unchanged. The replacement rate is not an additive bonus or overtime approval. Historical role assignments and dated immutable policy history determine the applicable rule. Today/future effective dates are supported; locked payroll inputs remain protected. All roles remain off until an authorized administrator configures them with actual amounts.

Both employee attendance estimates and employee/admin salary previews use the same daily calculation. Salary breakdowns show applicable threshold rates and the time paid under them. Finalized snapshots retain their original approved payloads.

## Migration and recovery

Migration `0010_shift_messages_daily_pay.sql` adds notification preferences/shift guards and a dated role-policy table with immutable history, payroll-lock guards and revision tracking. It also expires any pending reminders from the old 15-minute policy. No staff, schedules, scans or salary fixtures are added to production.

Private backup before release: `backups/shift-messages-daily-pay-20261011-145828/database.sql`, 218189 bytes.

SHA-256: `E5738B6ED5F1D6385A8CF6F24597D1BB409491769293DC1F3ABAF6143F4C6C2E`.

The additive schema remains compatible with the previous Worker. Do not remove historical role policies or overwrite the production database to roll back the UI. No production restore or test Telegram messages were performed.

## Validation

Local migration, production build and Wrangler dry run passed. Isolated calculation tests cover threshold boundaries, proportional hours, split visits, daily resets, early approved overtime, missing rates, future rules and disabled rules. Isolated API tests cover permissions, required enabled settings, idempotent saves, employee/admin calculation consistency, immutable history and earlier dates. Notification tests cover bounded timing, duplicate generation/delivery, cancellation, leave, checkout and independent opt-outs with mocked Telegram delivery.

Headless local browser checks passed at 320, 390, 768 and 1280 pixel widths. Verified the role toggle, threshold/rate save, optional reason and independent notification preference saves. Screenshots: [role setting](previews/daily-rate-mobile.png), [notification settings](previews/shift-notifications-mobile.png). These use synthetic local accounts; actual staff Telegram delivery depends on bot preferences and normal scheduled use.

Deployed version: `12568a45-788f-4ba5-bcfc-74cc4d0e4203`. Final app bundle: `index-oxDLH31L.js`.

209 tests were validated across the complete suite and affected-test reruns. The final affected-file run passed all 88 tests, including concurrent guarded delivery and queued encouragement opt-out. Readiness fixtures now discover every migration, and the frontend browser mock supports the review-guide mutation event. Final type checking and production build passed.

Production migration and deployment succeeded. Live availability and security checks passed. Read-only D1 verification found zero foreign-key errors and zero configured daily-rate policies, confirming example amounts were not applied to staff. Existing Worker, database, bot secrets, custom domain and minute cron were retained. Release checks sent no test Telegram messages or synthetic business records to production.
