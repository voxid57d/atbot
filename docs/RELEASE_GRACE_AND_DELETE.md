# Paid-hour grace and employee deletion — 31 October 2026

## Behavior

- Daily paid hours now include a 5-minute grace: eligible time within 5 minutes of the next whole hour counts as that hour (4h 55m pays 5 hours; 4h 54m pays 4). Grace minutes use the rate of the day's last payable interval. Open months recalculate; finalized versions keep their saved figures.
- Super administrators can permanently delete a disabled employee with no work or pay history after typing the full name. Only setup rows (schedules, role assignments, notification and session rows) and the account are removed; foreign keys refuse deletion when attendance, requests, reviews, payroll or audit records reference the person. Deletion is audited.

## Verification

- 302 of 303 tests passed; build passed. The failing test (`flags forgotten sessions…`) depends on the time of day and fails identically on the previous release.
- Release config, dry run, `verify-production`, `verify-security` passed. No pending migrations.
- Live: old workers.dev root still redirects (302); the delete endpoint rejects unauthenticated requests (401).

## Release record

- Private backup: `backups/grace-delete-20261031-145335/database.sql`, 2,583,983 bytes, SHA-256 `45A538106EF919B2CFB28FC7CA8C7E50F40E3532E17C1704424C330EFC2DBD53`.
- Rollback target: `49f4a2da-3294-4937-a1eb-d849e48566d2`. Current: `c6f5bda8-1737-4d97-9bba-14072ab9cb33`.
