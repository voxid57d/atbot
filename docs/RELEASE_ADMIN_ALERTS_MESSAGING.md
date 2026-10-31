# Admin alerts and personal Telegram messages

Successful QR check-in and checkout now notify every active admin and super admin with an enabled linked bot chat. Checkout includes employee name, checkout date/time in Tashkent and actual duration of this visit. Employee confirmations remain in place. Admin request, forgotten-checkout and daily-review alerts now also target both roles, regardless of individual attendance permissions. Notifications remain optional; /stop disables delivery. Attendance and alert enqueueing are atomic, session event keys deduplicate retries, and Telegram failures do not undo attendance.

Both admin roles can use **Team → Telegram messages** to choose any active registered user and send a private plain-text message through the bot. The sender's name is included. Recipients without a linked enabled chat cannot be messaged. The UI exposes the sender's own last 30 messages and queue/delivery states; "Sent to Telegram" confirms API acceptance, not reading. Uncertain deliveries are not automatically resent.

Messaging APIs enforce current admin role on every request. The outbox and audit event are one transaction and replay-safe. Delivery rechecks sender role, recipient activity, preferences and the recipient's Telegram identity captured at enqueue time. Relinking an account or demoting the sender prevents stale private messages being delivered. No payment, payroll or attendance mutation is part of personal messaging.

No schema migration required. Verification uses isolated D1 and mocked Telegram delivery, plus a local browser preview with notifications disabled. No real test messages or synthetic production attendance records were created. Private production backup taken before release.

Released Worker version: `9595e381-4d31-4a18-96e9-c632c8dae949`. Validation: 32 API regressions and eight frontend API/audit tests passed, strengthened alert delivery test passed for both admin roles, production build passed, and local browser checks passed at 320/390/768/1280 widths. Personal-message UI checks cover an unavailable bot, recipient selection, queue creation, form reset and delivery-history display.
