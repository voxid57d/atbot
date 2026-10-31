# Phase 4: discipline and daily reviews

Implemented and deployed on 10 October 2026 together with Phase 5. See [the production release record](PRODUCTION_RELEASE_PHASE5.md). The owner has authorized future deployments and migrations without a separate approval question.

## Implementation

The existing Worker, D1, authenticated Telegram sessions, attendance permission, audit log and transactional notification outbox are reused. No additional service, package or secret is required.

- Lateness uses the first effective arrival for each regular shift, with a documented 60-second threshold. Returning sessions and approved extra/coverage shifts do not generate additional lateness.
- Attendance administrators can confirm, excuse or reverse violations with reasons. Excuses and reversals recalculate subsequent monthly progression without changing attendance or paid-start rounding.
- Progression is ordered by work date, occurrence timestamp and stable source ID. First violation is a warning. Second and third configurable fines accumulate. Fourth requires a manager meeting and an optional additional fine. A configurable action/fine repeats from the fifth violation onward. Second, third and later fine amounts initially remain unset.
- Append-only policy versions apply at configured payroll-month boundaries. Explicit current-month changes recalculate proposals; prior months retain their policy. Historical and locked policy changes are blocked.
- Every recorded workday requires explicit Excellent, Good or Bad work-quality confirmation. Good is preselected but never saved automatically. Bad requires an explanation. Attendance corrections make existing work reviews stale.
- Employees declare **I Have a Uniform** after attendance is recorded. One declaration covers the whole workday. Missing/pending declarations remain review items without automatic violations. Administrators can approve submitted declarations, reject missing/failed uniforms or return decisions to pending. A late declaration preserves an existing rejection.
- Early departures have explicit approval/rejection, without invented worked time or an automatic fine. Attendance changes invalidate stale early-departure decisions.
- A review queue collects quality/uniform reviews, lateness, proposed consequences, early departures and manager meetings. Existing pending attendance requests and forgotten checkouts from all dates link to their established action screens. An employee filter narrows rows.
- Manager-meeting completions require an audited explanation and are matched to the applicable violation/progression.
- Immutable source snapshots preserve earlier detections after corrections or review changes. Superseded snapshots never count again. Audit history preserves administrators, reasons and reversals.
- Uniform rejection, Bad reviews and explicit disciplinary decisions enqueue notifications atomically. A deduplicated daily admin reminder covers outstanding historical daily reviews.

Review writes use a shared D1 revision guard: attendance, schedule, payroll-lock or competing review changes invalidate stale writes. Failed transactions also roll back their audit and notification records. Payroll locks block review changes. Fine proposals remain separate from deductions; final fine approval and settlement belong to Phase 5.

## Files and configuration

New: `shared/discipline.ts`, `backend/discipline.ts`, `frontend/discipline-ui.tsx`, `database/migrations/0004_discipline_reviews.sql`, two discipline test files and this report. Existing navigation, central text, mobile styles, attendance uniform panel, notifications, phase metadata and migration/verification fixtures were updated.

Migration `0004_discipline_reviews.sql` is required. Existing Worker/D1 bindings and secrets are reused. Configure actual fine amounts through the super-administrator policy form; examples are not production defaults.

## Verification

The full Phase 4 regression suite passed all 144 tests in eight files. Local browser checks passed through the actual Worker and isolated local D1 at widths 320, 390, 430, 768 and 1280: uniform declaration/approval, explicit Good/Bad review, admin queue and employee progression. No browser errors or page-wide overflow occurred. Synthetic identities and disabled notifications were used.

All migrations, including the corrected Phase 4 migration (51 commands), rehearsed successfully on a fresh isolated local database. The final combined Phase 5 suite passed 165 tests; build, Worker dry run and live release checks passed.

- [Uniform on a phone](previews/phase4-uniform-mobile.png)
- [Discipline on a phone](previews/phase4-discipline-mobile.png)
- [Review queue on desktop](previews/phase4-review-desktop.png)

Native Telegram and reception device checks remain Phase 6. Early-departure decisions do not invent a disciplinary fine schedule. The fifth-and-later policy repeats one configured rule; custom violation categories can be added later.

## Next phase

Phase 5 adds payroll previews, approved adjustments and fines, manual paid-leave adjustments (the owner's selected policy), immutable monthly snapshots, locks, salary history, CSV and audited reopening. Back up remote D1 before applying migrations. The owner's latest authorization supersedes earlier per-release approval requirements.
