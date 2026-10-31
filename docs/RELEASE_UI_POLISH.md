# UI consistency and simplification — 31 October 2026

## Behavior

- Clearer titles and labels (Overview, Requests, Reception displays, Cashier bonus, Debt share), readable audit sentences, capitalised roles and "Hasn't started the bot" in Telegram messages, distinct sidebar icons.
- One date/time format across screens (31 Oct 2026, 16:47); consistent filter bars with More options last; padded card grids; a switch for "Show disabled employees"; Add role inside its tab; single-row tabs on phones.
- Removed the duplicate top bar, workspace block, per-page date line (kept on Overview) and footer. Long explanations sit behind "How this works".
- Salary cards hide empty Pending/History and show the task count on "Review next task". Live attendance shows "Add manual attendance" on the card only when nothing was recorded.
- Admin access moved to each employee card's Actions menu; the Settings tab was removed. Role cards show a compact extended-hours link when the rule is off. Audit history is grouped by day with a "Changed by" filter.
- Schedules opens with the whole team's week from new read-only `GET /api/schedules/team` (up to 7 days, attendance permission).

## Verification

- 302 of 303 suite tests passed plus the new team-week API test; build passed. The failing `flags forgotten sessions…` test depends on the time of day and fails identically on the previous release.
- Local headless-browser tour of every admin page on desktop and phone with synthetic data: no page errors. Employee-only screens were not toured.
- Release config, dry run, `verify-production`, `verify-security` passed. No pending migrations. Live: old host redirects (302); team schedule endpoint rejects unauthenticated requests (401).

## Release record

- Private backup: `backups/ui-polish-20261031-165058/database.sql`, 2,420,220 bytes, SHA-256 `CA84EFF7A66DFDAF7D9F4E1ABFDA1C3DCA86B29E6E1AE9FAB8C126ACA66A1326`.
- Rollback target: `c6f5bda8-1737-4d97-9bba-14072ab9cb33`. Current: `15093ee5-d54e-4755-b6cd-a3bed74bfff8`.
