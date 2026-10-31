# Phase 5: payroll

This is a historical release record. For the current calendar-month workflow, available adjustment types and Pending/History review screens, use [the administrator guide](ADMIN_GUIDE.md) and [review inbox release](RELEASE_REVIEW_INBOX.md).

Implemented on 10 October 2026 using the existing Worker and D1. Paid absences use the owner's chosen policy: enter leave pay manually as an explicitly approved adjustment. No additional secrets or services are required.

## Payroll workflow

1. Open **Payroll**, select a date within the required payroll month, and inspect each employee's attendance and historical rates. The default period starts on the first of the month; the super administrator can configure day 1–28 before the first finalized payroll or custom disciplinary policy.
2. Resolve outstanding attendance requests, open sessions, missing rates, daily quality/uniform reviews, early departures and disciplinary decisions. Missing scans use the existing attendance correction workflow. Unapproved extra time and unexplained scheduled absences require an explicit resolution; resolving them does not create attendance or a fine.
3. Propose bonuses, deductions, salary advances or manual paid-leave amounts. Proposals do not affect salary until someone with `payroll.approve` explicitly approves them. A paid-leave adjustment must refer to an approved paid absence on the same date. An explicitly approved zero amount records a deliberate zero settlement.
4. Approve or reject each applicable fine proposal. An approved amount cannot exceed the proposal, and rejection records zero. Changing attendance, disciplinary status or progression invalidates the earlier financial decision.
5. Once the month has ended and every warning is resolved, finalize it with a reason. Finalization atomically saves an immutable salary snapshot, locks the period, records an audit event and queues employee notifications. It does not execute a bank transfer.
6. Download **Export finalized CSV**. Employees see only their own finalized breakdowns under **Salary history**.
7. For corrections, use **Reopen for correction** with a reason. The existing versions remain visible, with the latest version marked reopened. Correct unlocked attendance through the established request workflow or enter/reverse an adjustment, then finalize again to create a new version.

Salary editing permission can view payroll and propose adjustments. Financial decisions, finalization and reopening require payroll approval permission. Attendance permission alone grants no company payroll access. Server-side checks enforce these boundaries independently of navigation.

## Calculation and locking

Actual seconds and credited regular seconds remain separate. Regular attendance uses the existing interval union and paid-start rounding rules; overtime requires approved intervals and cannot overlap regular credit. Effective-dated historical role assignments and hourly rates apply to the work date, including changes within a month.

Integer currency calculations use BigInt numerators. Worked earnings are rounded once per employee/month to whole UZS. Base pay is rounded regular earnings; the overtime line receives the residual so base plus overtime always equals total worked earnings. Daily estimates are rounded individually and can differ from the monthly total when summed.

Final salary is worked earnings + approved bonuses + approved manual leave pay − approved deductions − advances − fines. Unapproved/rejected/reversed amounts never enter the total. Negative final pay blocks finalization for explicit resolution rather than being silently clamped.

Finalized previews and CSV read the saved snapshot. Database guards block attendance, manual correction, schedule, overtime and financial changes inside locked periods. Historical wage/assignment edits that could affect a locked period are also guarded. Immutable snapshots cannot be updated or deleted. Revision checks and transactional writes reject concurrent/stale approval attempts, with idempotent retries.

## Verification and release

All **165 tests in 10 files** passed, including 21 new payroll tests. They cover the supplied salary examples, historical rates, rounding, money overflow, manual paid leave, approval separation, fine recalculation, immutable snapshots, locked writes, audited reopening, concurrent finalization, CSV formula protection and employee isolation. Tests use disposable local D1 databases and fake Telegram credentials.

TypeScript checking, the Vite production build and Worker dry run passed. Real browser payroll verification passed at five mobile/desktop widths, including proposal/approval, actual CSV download, reopening and preserved employee versions. Both migrations are applied and the release is live; post-deployment asset, health, access-boundary and integrity checks passed. Details are recorded in [the Phase 5 release record](PRODUCTION_RELEASE_PHASE5.md). Migration `0005_payroll.sql` follows `0004_discipline_reviews.sql`; neither creates an additional Cloudflare resource or seeds wages/fine amounts.

## Limits and next phase

Configure actual fine amounts deliberately; examples are not defaults. Historical violations with unconfigured proposals need an explicit policy/review decision before finalization. Reopening is required for locked corrections; this release does not add arbitrary historical wage rewriting or employment rehire-history support.

Phase 6 is release and device verification, including real Telegram account isolation, notifications and Android reception/scanner behavior. Automated Chrome checks cannot establish native WebView or physical QR-device behavior.
