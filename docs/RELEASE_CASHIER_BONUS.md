# Cashier debt bonus production release

Deployed **15 October 2026** to the existing `staff-attendance-api` Worker and `staff-attendance-db` database.

- Site: https://staff.eshtaylakov.uz
- Worker version: `5a60ac69-e78e-4ebc-868f-4861bb034cc3`
- Applied migration: `0011_cashier_debt_bonus.sql`; no migrations remain pending.
- Private pre-migration backup: `backups/cashier-bonus-20261015-123054/database.sql`, 602852 bytes.
- Backup SHA-256: `CE580D6FE2418D0BFD1B5B7AED95ECB065C93E3A44BCEFC5F65FE2CF6A1055A7`.

The production build, release configuration and deployment dry run passed. Before release, the regression run passed 248 tests with one new test-fixture failure; that fixture was corrected and all four cashier integration cases subsequently passed, including effective-date eligibility, historical roles, carry-forward, salary privacy, stale/idempotent saves, extended rates and approved overtime, deductions, immutable snapshots, locks and CSV breakdown. The bonus unit tests and local browser save were also verified.

After deployment, `verify-production.mjs` and `verify-security.mjs` passed against the custom domain. The first live build check briefly saw the preceding HTML during propagation; a subsequent check confirmed the tested `index-1IplnegB.js` bundle and passed all checks, including the protected `/api/debtors` endpoint. The database foreign-key check returned no violations. The new debtor table contains zero entries: local sample figures were not deployed.

One migration request returned a transient connection failure before application; the retry applied successfully. The private backup succeeded in the current PowerShell runtime after the older wrapper stopped on a network warning. A diagnostic request to the workers.dev hostname timed out; the configured custom domain passed the complete live verification.

No rates, employee assignments, or debt counts were seeded in production. Cashier work from 15 October 2026 is eligible once real shared counts are entered. Existing payroll approval is still required to finalize salary snapshots. See [cashier setup and calculation rules](CASHIER_BONUS.md).

## Bonus display and daily record fix — 15 October 2026

Deployed Worker version `5be1babd-74f2-4186-a4e0-52837492a889`, bundle `index-DKYv69Ih.js`. No schema migration was needed.

The debtor section previously showed salary only for the signed-in cashier, so an administrator without a cashier profile saw no bonus breakdown. Administrators with existing salary/payroll permission now see each active cashier's fixed earnings, eligible earnings, debt bonus and final salary. Cashiers still receive only their own salary. The UI explains why open sessions, missing rates, no eligible earnings or a 30%+ debt rate can produce no bonus.

The daily-history API now returns only the last save for each day, while preserving every original write and audit record. Salary continues using the latest entered figures. Count fields clear zero on focus, allow typing without a leading zero and restore zero if left blank.

Validation: production build and release configuration passed; 20 focused unit/integration tests passed. Browser checks with a clearly marked local cashier verified 36,000 UZS earnings plus 21,600 UZS bonus at 8%; a second same-day save at 10% changed the bonus to 18,000 UZS and left one daily record. Zero cleared when selected, and typing `2` produced `2`.

Private backup: `backups/cashier-display-fix-20261015-124625/database.sql` (606410 bytes), SHA-256 `E59DFDF18591D5CFA01D4A200B2FDC3B5FD1F9CEF22DF10A0C8DB6A2BB12C181`. Live production/security checks passed. Production debtor entry 1 was preserved unchanged, and the foreign-key check returned no violations. Local preview data was not deployed.

## Whole-month cashier earnings correction — 15 October 2026

The user clarified that the launch date must not limit the current month's earnings. The shared multiplier now covers each employee's cashier earnings for the entire payroll month, including cashier work before 15 October. Work in other roles is excluded using historical role assignments. Earlier months and finalized snapshots remain unchanged. Calculation version is now 5; no migration or production data edit was required.

Deployed Worker version `83e029bb-c0fa-4321-b45b-726eb6319c46`, bundle `index-B1P2nnw2.js`. The production build, release configuration, all 40 bonus/payroll tests and live production/security checks passed. The regression test includes cashier work on 1 October, office-manager work on 14 October, and cashier work on 15 October: total earnings 324,000 UZS, eligible cashier earnings 216,000 UZS, and bonus 129,600 UZS at the shared 1.6× multiplier.

Private backup: `backups/cashier-whole-month-20261015-125633/database.sql` (606410 bytes), SHA-256 `02E673523C33789B0F4D717DEA10B6098811A23735DE591962724BFF0DC4B830`.
