# Super-admin Telegram check-in alerts

Every successful QR check-in now queues a Telegram alert for active super admins in the same database transaction as attendance. The message includes employee name, work date, exact check-in time in Asia/Tashkent, assigned shift times (or no assigned shift) and the staff workspace link. Employee confirmations remain in place. Checkouts and historical attendance corrections do not generate these alerts.

Each session has a unique event key per recipient. Replayed check-ins and rejected attempts do not create duplicates. The existing minute cron delivers messages through the bot; Telegram failures never undo attendance. Existing enabled/disabled bot preferences, verified private-chat links and ambiguous-delivery safeguards are preserved. Delivery and claiming recheck current recipient eligibility; a demoted super admin cannot receive this alert even if they retain attendance admin permission.

No migration required. Tests use isolated D1 and a mocked Telegram sender. The production super-admin account was checked read-only and has a linked enabled bot chat. No real test messages or synthetic production check-ins were sent. Private production backup taken before release.

Released version: `ccb58cfc-9734-462b-9905-cd7f8b983a11`. Nine targeted notification tests, TypeScript/production build, live production checks and live security checks passed.
