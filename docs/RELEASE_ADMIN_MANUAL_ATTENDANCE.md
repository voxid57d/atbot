# Admin manual attendance

Live attendance now offers **Add manual attendance** on each employee card for today or a past date. The form retains the selected workday and accepts actual arrival/departure times in Asia/Tashkent plus an optional reason. Saving creates an approved correction and manual attendance interval without worker submission or QR scans. The card marks the visit **Manually recorded**, employee estimates and salary figures recalculate, and the employee receives a bot notice that attendance was recorded by an administrator.

Requires `attendance.manage`; ordinary employees cannot use the API. Arrival/departure must fall within one employment workday, be in the past and span no more than 18 hours. Existing approval triggers check overlapping scanned/manual attendance and payroll locks atomically. Pending correction requests must be reviewed first. All request, approval, attendance, audit, notification and idempotency changes are one transaction. Retrying does not create another visit. Existing scanned records remain unchanged.

Manual recording follows the existing regular schedule and whole-hour salary policy. Time outside regular shifts still requires overtime approval. A finalized month must be reopened before changes. Historical additions are limited to the employee's employment dates; disabled employees remain hidden until explicitly shown.

No schema migration required. Verification uses isolated D1 and synthetic local browser records with Telegram delivery disabled. No production staff attendance was added or changed during QA. Private production backup taken before release.

Deployed version: `c73a643d-3fcc-456b-9ded-ca4260946990`. Validation: four targeted correction/manual API tests and 55 attendance, payroll, whole-hour, audit and review-navigation regressions passed; production build passed. Browser workflow passed at 320/390/768/1280 widths, including blank optional reason, saved timestamps and manual badge. Initial synthetic fixtures were corrected to include a regular schedule for salary expectations and a valid employee activation date.
