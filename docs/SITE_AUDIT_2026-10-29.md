# Site audit — 29 October 2026

Implementation follow-up: the owner confirmed the paid-start rounding and monthly fine progression as intended, and authorized the other suggested fixes. See [the review inbox release](RELEASE_REVIEW_INBOX.md) for the implementation and validation record. The findings below retain the original audit context.

## Scope and result

Investigated the supplied Monthly salaries screenshot and traced the connected schedules, attendance, requests, discipline, payroll, cashier-bonus, navigation and notification code. No production business records were changed, no messages were sent and no application fixes were deployed. This document records findings and a proposed simplification, rather than changing business rules during the investigation.

The screenshot is explained by a confirmed rendering defect: completed fine decisions remain displayed as editable approval tasks. The zero beside “Adjustments and decisions” counts another collection entirely. This is not evidence that approval failed or that the same fine was deducted twice.

Verification:

- TypeScript and production build passed. The generated main bundle is `index-X9e2WQCB.js`, matching the live site.
- 111 existing unit tests across 12 suites passed.
- Seven temporary diagnostic tests passed, asserting the observed defects. They exercised rendered React output, shared calculations, and actual backend snapshot/preview functions with all 12 migrations applied to an in-memory SQLite database. These are diagnostic reproductions, not claims that the defects are correct behavior. The temporary tests were removed after investigation.
- Existing live production and security verification scripts passed: assets, health, private endpoint access boundaries, reception assets and deliberately invalid requests. No accounts, sessions, business records or messages were created by those checks.
- The full Miniflare/D1 integration run produced no completed-suite results during the investigation and was stopped. It is not reported as passing. The SQLite probes do not substitute for the complete Cloudflare runtime suite.
- No authenticated browser walkthrough or real Telegram/tablet exercise was performed. Private-record conclusions come from the supplied screenshot and synthetic reproduction, not inspection of live employee records.

## Findings

### 1. Completed fines remain in the review area — high priority, reproduced

`frontend/payroll-ui.tsx:677–738` renders approval forms whenever the month is open, the user can approve, and a violation has a positive ordinal and positive proposed fine. It never excludes an existing valid `fineDecision`.

Meanwhile, `backend/payroll.ts:263–272` matches financial decisions to the current progression token, and `backend/payroll.ts:419–425` creates a fine-approval warning only if no matching decision exists. The backend therefore considers a saved approval or rejection complete while the frontend continues to offer “Confirm review.”

The screenshot's “approved · 50,000 UZS” and “approved · 100,000 UZS” are consistent with saved financial decisions. The approval endpoint upserts by violation ID (`backend/payroll.ts:626–681`); the total uses each matching approved violation once. Repeatedly seeing the form does not itself multiply deductions.

The “Adjustments and decisions (0)” summary at `frontend/payroll-ui.tsx:609–675` counts salary-adjustment records only. Fine forms are siblings outside that disclosure. It is not a count of the visible fine decisions or all remaining reviews.

**Change:** Show only unresolved, actionable fines under Pending. Put approved/rejected decisions into History with an explicit Change decision action. Calculate the pending count from the same records being shown. Keep obsolete decisions in audit history and reopen the task when its relevant source changes.

### 2. Fine forms offer invalid or misleading defaults — reproduced/source confirmed

The decision dropdown always starts with Approve, including when the existing decision is Rejected. The amount is initialized from the previous decision or proposal. Choosing Reject does not set it to zero. The backend correctly rejects a rejected decision with a nonzero amount (`backend/payroll.ts:644–654`). Positive proposals for still-detected lateness are also offered for approval even though the backend requires the violation to be confirmed first.

**Change:** Offer separate Approve amount and Reject fine actions; rejection sends zero. Use explicit Edit mode for an existing decision. Until lateness is resolved, show “Confirm or excuse lateness first” instead of a financial submit button. Validate the amount against the current proposal before submitting.

### 3. Overview can say zero reviews when Daily reviews still has work — reproduced

The Reviews due metric (`frontend/overview-ui.tsx:132–174`) counts quality, uniform, manager meetings and early departures. It omits detected lateness and unconfigured fines, both of which `needsViolationReview` in `frontend/discipline-ui.tsx:33–37` treats as pending. The diagnostic rendered an overview with one unresolved lateness violation and a displayed review count of zero.

The separate Payroll issues metric is scoped to the current month, despite the hint “All unresolved payroll warnings.” It cannot reveal an unresolved September month when October is selected implicitly. This is a scope-label problem, not evidence that old records are deleted.

**Change:** Use a common task source and explicit period labels. A dashboard count should open exactly the items it counted. Add a separate previous-months-needing-attention indicator if that is desired.

### 4. Split-shift checkout timing still follows the first shift — high priority, reproduced

For regular windows 08:00–10:00 and 14:00–18:00, a continuous attendance session starting at 08:00 remains associated with the morning shift. `shared/checkout.ts:16–47` sets its expected end to 10:00 and extends it only for connected approved overtime/extra windows. It does not move to the later regular shift.

At 15:00 the helper returns `review` with an expected end of 10:00, although the documented split-shift workflow supports a single session spanning both regular windows. Live attendance, payroll checkout warnings and checkout messages use this helper.

**Change:** Define the supported continuous-session behavior across split shifts, including the break, and share that rule across reminders, attendance and payroll. If checkout during the break is mandatory, the documented continuous-session support and UI must change together; do not silently change salary credit.

### 5. A spanning session can miss an afternoon early departure — high priority, reproduced through the backend

With those same windows, a session 08:00–17:00 earns five credited regular hours, correctly excluding the break. However, `backend/discipline.ts:219–248` finds sessions for each shift using exact `shift_id` equality. The session belongs to the morning shift, so the afternoon shift has no matching records and produces no early-departure item. The morning shift ended at 10:00, so it also produces none.

The backend snapshot returned no early-departure task despite departure one hour before the second shift ended. `shared/attendance.ts:126–150` also calculates the summary departure against just the first regular shift.

**Change:** Evaluate actual coverage of every scheduled window, including a session spanning several windows, and generate the departure task for the affected window. Keep one physical session; do not fabricate separate scan records.

### 6. Attendance and discipline disagree about afternoon lateness — reproduced against the actual schema

For sessions 08:00–10:00 and 14:12–18:00, the discipline SQL view correctly produces a 12-minute afternoon lateness violation (`database/migrations/0004_discipline_reviews.sql:48–58`). The shared attendance summary reports zero minutes because it inspects only the first regular shift (`shared/attendance.ts:126–146`).

**Change:** Show lateness per shift and derive daily summaries consistently. Decide whether the daily summary should total lateness or show separate arrivals; either choice must agree with the violation detail.

### 7. “No attendance” becomes a review task before today's shift starts — reproduced through payroll preview

`backend/payroll.ts:358–390` creates an unworked-day warning when a scheduled date is today or earlier and no attendance/approved absence exists. It does not wait until the shift or workday ends. An in-memory preview frozen at noon produced that warning for an evening shift that had not started.

**Change:** Classify future work as Upcoming, active work as In progress, and no-show decisions as due only after the relevant work window ends. Do not ask administrators to confirm “no worked time” in advance.

### 8. Forgotten-checkout and ordinary-work wording differ across screens — source confirmed

Live attendance and payroll use the expected-end helper with 30-minute overdue and 60-minute review thresholds. Daily reviews uses “previous workdate or 18 hours since check-in” (`frontend/discipline-ui.tsx:681–725`). It can omit the same checkout task that payroll flags after an hour.

In addition, a daily review card displays the “Resolve forgotten checkouts” message whenever any session is open (`frontend/discipline-ui.tsx:250–253`), including an ordinary shift still in progress. Quality can be saved during that session, but checkout changes the attendance snapshot and makes that quality review pending again (`backend/discipline.ts:201–208,375–431`). Re-review after a material correction is intentional; routine mid-shift save/reopen churn is avoidable.

**Change:** Use one checkout status everywhere, reserve Forgotten/Needs review for genuinely due work, and make the completed workday the natural unit for quality review. Show a clear reason when a completed review becomes stale.

### 9. Refreshed forms can retain old drafts and confirmation state — source finding; needs interactive regression coverage

`Field` uses `defaultValue`, and `Form` retains its `success` and idempotency state for its mounted lifetime (`frontend/attendance-ui.tsx:95–197`). Fine cards are keyed by violation ID, not the reviewed proposal version. Consequently, a refreshed proposal with the same ID does not reliably reinitialize the entered amount, decision or “Confirmed” button state. A newly stale decision can require action while the existing form still reflects the previous save.

There is also one global `discipline_state.revision` used for concurrency checks. Attendance, reviews and debtor changes can invalidate another administrator's open payroll form. That protects against stale writes but creates avoidable conflicts; the debtor form deliberately freezes its starting revision until explicit refresh.

**Change:** Bind review drafts and saved state to the relevant source version. Preserve unsaved user input deliberately, show “This proposal changed,” and require refresh/reconfirmation. Investigate more narrowly scoped concurrency versions separately; keep atomic guards and idempotency.

### 10. History labels, permissions and locked-period instructions drift — source confirmed

- “Approved fines” includes every non-null fine decision, including rejected zero decisions (`frontend/payroll-ui.tsx:270–280`). Rename the history or filter it accurately.
- The fine-policy task is treated as reviewable with attendance permission (`frontend/salary-tasks.ts:35–61`), but editing the policy requires the super administrator (`backend/discipline.ts:639–664`). An attendance admin can excuse/reverse a violation, but cannot configure a legitimate missing fine amount. Guidance should distinguish those actions and identify the owner needed for policy configuration.
- Several locked-record errors say to use an adjustment (`backend/discipline.ts:119`, `backend/requests.ts:71`, `frontend/text.ts:134`). An adjustment does not unlock the attendance/review record, and it cannot be inserted inside the same locked period. The supported correction path is payroll reopening by an authorized approver, correction, and refinalization. If a later-month adjustment is intended, say so explicitly.
- The debtor page says only a super administrator can reopen payroll; the endpoint permits `payroll.approve` (`frontend/debtors-ui.tsx:53`, `backend/payroll.ts:807–813`).
- The extended-hours form says partial hours are proportional (`frontend/role-pay-ui.tsx:124–127`), while pay now discards the final partial payable hour each day. Proration can still occur within a retained whole hour across a threshold, but the current wording invites the wrong salary expectation.
- Older phase documentation and unused copy still describe configurable month starts and new advances. Current payroll validation accepts only calendar-month day 1 and new bonus/deduction/leave-pay adjustments. The current administrator guide is closer to the implementation than the older phase guides.

## Current workflow, end to end

1. **Set up people and policy.** An administrator configures roles/levels, effective-dated hourly rates, employee activation dates and role assignments. Super administrators grant access; employee management, attendance management, salary management, payroll approval and audit access are distinct. Fine amounts are configured explicitly, not seeded as real wages/fines.
2. **Schedule work.** Weekly rules create dated regular shifts. One-day overrides take precedence. Each day can have two regular windows; their gap is unpaid. Extra shifts and overtime authorization are separate. Historical daily changes preserve correction history; finalized months protect their inputs.
3. **Record attendance.** An employee scans the reception QR on arrival and departure. Multiple visits are supported. Manual attendance and corrections preserve original records and audits. The employee declares uniform once per day; an administrator can supply an observation when no declaration exists. The minute job closes remaining open sessions at 23:00 Tashkent, and check-ins are blocked from 23:00 to midnight.
4. **Calculate eligible time.** Open sessions earn no salary yet. Regular credit is limited to scheduled windows, excluding breaks. The first arrival's paid-start rule rounds backward to an hourly boundary measured from the shift start: for example, 08:12 arrival for an 08:00 shift can receive credit from 08:00 while still being 12 minutes late. This is an existing business rule, separate from disciplinary fines. Approved overtime pays only real recorded time outside regular windows; approval does not create attendance. Credited regular and approved overtime combine per day, then the final incomplete hour is discarded. Remainders do not carry to another day. Historical rates and any extended-hours replacement rate apply to the retained payable time.
5. **Resolve requests and daily reviews.** Absences, missing scans, corrections, overtime and coverage have separate approval paths. Coverage normally requires the covering employee's acceptance. Paid absence alone does not create leave pay: an explicit leave-pay adjustment is needed. Each worked day requires saved quality and uniform decisions. Bad quality and rejected uniform create violations; lateness is detected and then confirmed/excused/reversed. Early-departure permission is recorded separately and does not automatically pay missed time or create a fine.
6. **Calculate disciplinary progression.** Counted lateness, quality and uniform violations share the employee's monthly sequence. First is a warning; second and third propose configured fines; fourth requires a manager meeting and can have its configured fine; fifth and later repeat the configured later action/fine. Detected, unexcused lateness provisionally participates in this progression, so resolving an earlier incident can change later proposals. This order is not simply a fine per late minute: two minutes late can have a larger proposed fine than twelve minutes late because their monthly positions differ.
7. **Approve money.** A payroll approver explicitly approves a fine amount up to the proposal or rejects it with zero. A disciplinary confirmation and a financial approval are different decisions. The current source/progression token determines whether a stored financial decision applies. Bonuses, deductions and manual leave pay are proposed separately and count only when approved. Cashier bonus uses the latest shared debtor percentage available for that payroll month and the employee's eligible cashier earnings; it is not an average of daily percentages. Payment/advance tracking is in the separate LMS; historical advances can remain in old data.
8. **Review the month.** Monthly salaries gathers unresolved attendance, rate, review, fine, adjustment, leave-pay, no-show and overtime issues. Hidden disabled employees' earnings and blockers still count. Salary is worked earnings + approved bonuses + cashier bonus + approved leave pay − approved deductions − applicable approved fines − any historical advances. Actual recorded duration, credited eligible time and paid whole hours are different figures.
9. **Finalize and correct.** An authorized approver finalizes only after the month ends, all sessions close, all warnings resolve and at least one employee entry exists. Negative salary is a blocker. Finalization saves an immutable version, locks its inputs and enables finalized CSV export; it is not a bank transfer. Reopening unlocks corrections with an audit record, preserves old versions and allows a new finalized version.
10. **Deliver notifications.** The minute job prepares/reminds/delivers Telegram messages through an outbox. Attendance and payroll changes remain recorded if notification delivery fails. Sent means Telegram accepted delivery, not that the recipient read the message. Automatic checkout runs independently of notification settings.

## Simplification proposal

### One review inbox, with one count and one history

Use a shared server task representation: employee, workday, task kind, source version, pending/blocked/completed state, prerequisite, permitted action, and decision metadata. Generate it from current records; it need not become a duplicate authoritative financial ledger.

Overview, Daily reviews, Monthly salaries and the guided reviewer should all consume this task source. Pending shows only unresolved work. History contains completed decisions. A count is always the count of the visible pending set. Blocked tasks explain the prerequisite instead of offering a submit action the API will reject.

### Make employee + day the daily review unit

One day card should show both shifts, scans, gaps, actual duration, credited time and paid hours. Present quality, uniform, lateness and early-departure decisions together, with explicit confirmation. Label an active workday In progress and make end-of-day review the default. Keep changing an earlier decision and reviewing its financial consequence on the same screen when the user has both permissions.

Do not silently preapprove Good, eliminate financial approval, or erase prior decisions. Saving compatible daily decisions together can reduce clicks while preserving separate authorization and audit records.

### Keep monthly salaries focused

Use one salary card per employee: amount, paid hours, Pending N / In progress / Ready / Finalized. Provide Review next, Breakdown and History. Completed fine forms should not remain under Pending. Keep policy/rate configuration in Settings and link blocked tasks to the right owner or editor. Keep payment tracking in the LMS.

For fine decisions, offer Approve [editable amount] and Reject; Reject always sends zero. For history, show a compact sentence such as “16 Oct · Lateness · Approved 50,000 UZS,” plus approver/time and Change decision when permitted.

### Preserve policies while simplifying the interface

The existing backward paid-start rounding, daily whole-hour rule, cumulative monthly discipline, 23:00 automatic closure and manual paid-leave step are business policies. They explain much of the apparent complexity and should be reviewed explicitly before changing calculations.

In particular, automatically closing a forgotten visit can turn scheduled time up to the cutoff into payable attendance even if the employee left earlier. The close is journaled but does not itself prove the departure time. Consider a review state for automatic closes before final payroll. This is a policy proposal, not a claim that the current 23:00 behavior violates its implemented specification.

## Suggested implementation order

1. Fix pending/history separation, counts, rejection behavior and prerequisite gating. Add focused UI regression coverage for saved approved/rejected decisions and stale proposals.
2. Fix split-shift time/status calculations and premature no-show tasks. Cover spanning visits, separate visits, late returns, early departures, breaks and checkout reminders together.
3. Unify task generation/counts and status wording; correct permission routing and locked-period instructions.
4. Consolidate the employee-day review screen and remove duplicate nested decision controls.
5. Discuss business-rule changes separately, using sample salaries and disciplinary sequences before changing policy.

Before releasing application fixes, complete the existing full D1 integration suite in a functioning runtime and perform an authenticated mobile/desktop walkthrough. This audit changes documentation only.
