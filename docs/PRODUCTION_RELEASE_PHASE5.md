# Phase 4 and 5 production release

Released on 10 October 2026 under the owner's standing authorization for future deployments and necessary migrations. Phase 4's interrupted final verification was completed before proceeding to Phase 5. No additional Worker, database or secret was created.

- App: https://staff-attendance-api.voxid-mr.workers.dev
- Worker: `staff-attendance-api`
- D1: `staff-attendance-db`, binding `DB`, ID `0d6fc486-37ad-4639-a199-00f92e765778`
- Active Worker version: `dec71a7e-045e-4b75-ac22-bba6e137a112`
- Main frontend bundle: `/assets/index-DaGZFAUS.js`
- Notifications remain enabled with the existing one-minute cron, bot and webhook secrets.

## Backup and migration

Before migration, a private export was saved to the ignored `backups/phase5-release-20261010/pre-phase5.sql`. It is 34,754 bytes. The directory ACL permits only the current Windows owner, with inherited access disabled. Export output was withheld to avoid exposing signed download URLs. The export contains private data and must not be shared.

SHA-256: `2C4C7E377117C694A92DA450B9287A78B3F35DC1280AB9411D95E7393F0607E4`.

Production inspection found exactly two pending migrations. `0004_discipline_reviews.sql` applied 51 commands, followed by `0005_payroll.sql` with 61 commands. Afterwards, Wrangler reported no pending migrations and `PRAGMA foreign_key_check` returned no errors.

Before and after migration, production had two users, one employee, one hourly-rate record, one attendance session, one registered tablet and one employee request. New payroll periods, snapshots, adjustments and fine decisions were all empty. No synthetic production records, financial decisions or payroll finalizations were created. No bot-token or webhook change was required.

## Validation

- Phase 4: all 144 tests passed, followed by responsive browser verification of explicit quality reviews, uniform declaration/approval, review queues and employee progression.
- Phase 5: all 165 tests in ten files passed, including 21 payroll tests. TypeScript/Vite build and Worker dry-run bundling passed.
- Real local HTTP/Worker/D1 browser verification exercised bonus proposal and approval, a 118,000 UZS employee snapshot, actual CSV download, audited reopening/refinalization and employee-only history preserving two versions. Fake Telegram identities and disabled delivery were used; records remained in isolated local storage.
- Browser checks covered widths 320, 390, 430, 768 and 1280 with no page-wide overflow or page errors. Screenshots were visually inspected. A period-switch form-date issue was corrected and verified before release.
- Live checks passed for current tested frontend bundles, Phase 5 D1 health, CSP/HSTS, unauthenticated attendance/review/payroll/admin/tablet protection, reception PWA files and invalid Telegram login rejection. The invalid login created no account or session.

### Preview evidence

- [Payroll on a phone](previews/phase5-payroll-mobile.png)
- [Employee salary history on a phone](previews/phase5-salary-history-mobile.png)
- [Payroll on desktop](previews/phase5-payroll-desktop.png)

The screenshots contain clearly marked synthetic local fixtures, not production employee data.

## Owner workflow and Phase 6

Close and reopen the Telegram Mini App to load the release. Administrators use **Daily reviews** and **Payroll**; employees use **My reviews & discipline** and **Salary history**. Paid absences require a manually entered, explicitly approved leave-pay adjustment, as selected by the owner. Actual fine amounts must be deliberately configured; example amounts were not seeded.

See [the payroll workflow](PHASE_5.md). Phase 6 remains real Telegram/Android reception and scanner verification, notification delivery verification, and operational release checks. Chrome automation does not prove native Telegram device behavior.
