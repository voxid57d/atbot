# IELTS ZONE administrator guide

Open `@izamirtemurbot` and launch the workspace from Telegram. The app verifies the selected Telegram account; sharing a browser session does not grant another account your permissions. Close and reopen the Mini App after changing accounts or access.

## Initial setup

1. In **Roles & rates**, create the approved levels and integer UZS hourly rates, effective on or before the employee's activation date. Four role names are seeded; wages and fine amounts are not.
2. In **Employees**, register each person's verified numeric Telegram ID, level and activation date. Telegram usernames are not identifiers. Only a super administrator can correct a Telegram link; relinking revokes old sessions and is audited.
3. In **Admin access**, grant only necessary permissions. Employee management, salary editing, payroll approval, attendance management and audit viewing are separate. Access changes revoke existing sessions.
4. In **Schedules**, add regular weekly hours or a one-day override. Review the resulting shifts before attendance is recorded. Daily schedule corrections remain possible after attendance, with preserved before/after history.
5. In **Reception displays**, register and pair the reception tablet using the [tablet setup guide](DEVICE_CHECKS.md).
6. Salaries use calendar months (first through last day). Configure real disciplinary amounts through the super-administrator policy form, with the effective period and reason. Missing amounts remain unresolved proposals.

## Editing schedules

Navigation groups daily work, team management and settings. **Overview** links directly to current attendance, pending requests, monthly review actions and payroll warnings, according to your permissions. Pending request and review counts hide disabled employees; payroll warnings retain unresolved items for everyone. On phones, **Live attendance** shows employee cards; expand **Attendance details** for credited time and lateness.

In **Schedules**, select the employee in **View the next week**, which appears first. Use **Add shift** to expand the creation form. Use **Edit weekly schedule** to change recurring weekday hours or enable/disable that weekday. The form starts with saved values. Choose an effective date; an optional note helps explain the change. A later effective date creates a new version and preserves the earlier rule.

Use **Edit this day** beside a shift for a one-day exception, cancellation or restoration. Extra shifts also allow approval changes. Save changes to refresh the displayed schedule. If another administrator changes a schedule while your editor is open, use **Refresh** and reopen the editor.

Edits are audited. Use the daily editor for past or recorded days: it previews credited time, preserves original scans, and stores both schedule versions. Finalized payroll periods still require reopening; extra shifts created by accepted coverage remain protected. For recurring changes after attendance exists, choose an effective date after the protected history. Use the attendance correction workflow for incorrect recorded times.

## Disabled employees

Disabling an employee revokes access and hides their records by default in attendance, employees, requests, daily reviews, schedules, admin access and payroll. Use **Show disabled employees** to reveal them, and **Hide disabled employees** to return to the usual view. Records and audit history are preserved; this is a display filter, not deletion or a new authorization boundary.

Payroll totals and CSV exports still include earnings owed to disabled employees. Any hidden payroll warnings must still be resolved before finalization; reveal their records to review them.

## Each workday

Workers can expand **Telegram notifications** below their attendance/request history. Start the bot chat, enable notifications, then choose shift reminders and encouragement separately. Existing reminder opt-outs are preserved. Reminders arrive around 30 minutes before the scheduled start and 10 minutes before the scheduled end; the end reminder requires an open attendance session. Encouragement is sent only while checked in: one message on shifts lasting two to under six hours, two on shifts lasting six hours or more. Very short shifts receive reminders only. Messages use English and Tashkent time. Approved absences suppress shift messages; approved sick leave receives a warm recovery message once in the request decision.

Queued shift messages expire and are checked again against schedule changes, leave, attendance and preferences before delivery. Missed message windows during an outage are skipped rather than sent long after their intended time. Existing notification retry and duplicate-protection rules still apply.

- Employees scan the live reception QR both when arriving and when leaving. Each code is valid for one minute. Multiple visits are separate sessions. Employees choose whether they have a uniform after attendance is recorded. A pending selection can be corrected; a reviewed selection requires the admin to return it to pending first.
- Use **Live attendance** for open sessions, forgotten checkouts, schedules and approved absences. Open sessions earn no estimated pay. Confirm actual departure times with evidence or approve a correction; do not invent hours to clear an alert.
- A normal check-in is **Working**, with no missing-checkout task. The employee gets a gentle reminder at the expected shift end, **Checkout overdue** after 30 minutes, and **Needs checkout review** after 60 minutes. Connected approved overtime extends the expected end; crossing midnight does not trigger an alert. Without a schedule, the expected end falls 18 hours after check-in, followed by the same grace periods.
- Salary cards show **In progress - pay pending checkout** for open sessions. Only sessions past the 60-minute review deadline count as checkout issues. All sessions in a payroll month must still be closed before finalization. Reminders are deduplicated per session and stage, and queued reminders are checked again before delivery.
- If a forgotten session is still open, use **Close session** with the actual time. If it was already checked out at the wrong time (for example, the next morning), select its original workday in **Live attendance** and use **Correct checkout** beside the recorded session. Enter the confirmed actual departure in Tashkent time; the reason is optional. The original scan record is preserved, the administrator and correction are recorded, and salary/review calculations refresh. A salary warning for invalid attendance now opens this editor directly, instead of an empty Requests queue. Locked months require reopening first; overlapping or stale corrections are rejected. Direct corrections also appear as approved administrator corrections in request history.
- Use **Requests** for absence, missing scans, timestamp corrections, overtime and coverage. Approval requires an explicit decision; reasons are optional. Coverage is created only after the covering employee accepts. Overtime approval permits paying real recorded time; it does not create attendance.
- Use **Review inbox** for mandatory quality/uniform decisions. Good may be preselected, but must be explicitly saved. Comments are optional. Confirm, excuse or reverse detected violations with optional reasons; corrections can invalidate prior decisions.
- Review early departures and manager-meeting tasks. Early-departure decisions record permission without adding pay or automatically creating a fine.

## Month end

For cashier debt bonuses (available from 15 October 2026), use **Debtors & cashier bonus** to save the shared counts. Cashiers can also enter figures and see their own salary impact. The latest percentage determines the open month's cashier bonus; deductions apply afterward. Payroll finalization approves and preserves that result. Assign a Cashier level under **Employees** to enable cashier access; do not grant admin access for this. See [the complete rules and multiplier table](CASHIER_BONUS.md).

In **Roles & rates**, expand a role's **Daily extended-hours rate** setting. Enable the rule, enter the daily hours threshold and replacement hourly UZS rate, then choose today's or a future effective date. For example, after eight salary-counted hours, later time that day uses the replacement rate. This is not an extra bonus. Regular credited time and approved overtime count together in chronological order; gaps do not count, multiple visits combine and the count resets daily. Partial hours are proportional. Overtime still requires approval. Rules apply to all levels of the selected role and follow each employee's historical role assignment. Each saved change remains in the rule history; earlier dates and finalized snapshots retain their applicable rules. No role is enabled automatically by the release.

Select the calendar month in **Monthly salaries**. The summary includes hidden disabled employees. Each employee has a card with calculated salary, recorded duration, paid hours and review status. **Pending** contains unresolved decisions; waiting tasks explain their prerequisites. **History** contains completed adjustments and fine decisions, with an explicit **Change decision** action where permitted. Superseded fine decisions stay visible in history and do not affect salary. **Salary breakdown** explains the calculation. **Review next task** opens an available decision and refreshes the guide after saving; **Back to monthly salaries** returns to the employee's card. Ordinary sidebar navigation exits the guided sequence.

The **Review inbox** groups pending work by employee and day, including both regular shifts and their recorded visits. Its count and the overview's monthly review count use the same tasks. Quality review becomes available after the final scheduled shift ends and all attendance is closed. Uniform and lateness decisions remain explicit. Payroll approvers can decide a proposed fine on the workday card without leaving the inbox: **Approve amount** accepts up to the proposal; **Reject fine (zero)** records zero automatically. Completed daily reviews and fine decisions move to **History**. If a record changes while a draft is open, load its current values before deciding.

For split shifts, a continuous visit follows the last regular shift's end for checkout reminders, while the break remains unpaid. Lateness and early departure are shown for each regular window. A no-attendance payroll review becomes due after the day's last regular shift ends. The paid-start rounding and monthly fine progression remain separate, intentional policies.

Employees select their month in **My salary**; open months show provisional figures and finalized months retain approved versions. This ERP calculates salary numbers only; payment and advance tracking belong in the separate LMS. New advances are unavailable. Resolve every warning, approve or reject adjustments and applicable fines, then use **Finalize month** for an ended month. Its panel explains any blockers, including outstanding reviews or an ongoing month. Paid absences require a manually entered, approved `leave_pay` adjustment on the absence date. Salary editing alone cannot approve payroll.

Finalization preserves an immutable version and locks its inputs. CSV exports use the approved version. Reopen with an audited action and optional note before correcting locked records; previous employee salary versions remain visible. Finalization is a calculation/approval record, not a bank transfer.

## Errors and incidents

| Situation                         | Action                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Account not registered            | Confirm the selected Telegram account and its registered numeric ID.                                                       |
| Session expired/account changed   | Close the Mini App and reopen from the intended Telegram account.                                                          |
| Invalid/expired QR                | Scan the current live tablet code; codes are valid for one minute and renew before expiry.                                 |
| Request changed during review     | Refresh and review the latest records before submitting again.                                                             |
| Locked period                     | Use the authorized payroll reopening workflow; preserve prior versions.                                                    |
| Internet/backend unavailable      | Keep a manager-controlled paper record with actual arrival/departure times. Use audited corrections after service returns. |
| Tablet lost/reset/cookies cleared | Revoke its registration and pair a replacement registration.                                                               |
| Notification missing              | User sends `/start`, checks app preferences and bot blocking; operator checks notification queue status.                   |

Do not silently retry uncertain Telegram deliveries: the outbox marks ambiguous results `uncertain` to avoid duplicate messages. A recorded `sent` result proves Bot API acceptance, not that the recipient read the message.

## Routine operations

If both attendance scans are missing, select the workday in **Live attendance**, find the employee and choose **Add manual attendance**. Enter actual arrival and departure times in Tashkent, optionally add a reason, then save. The record is approved immediately, marked **Manually recorded** and audited; the employee receives a bot notice. Resolve any pending correction first. Overlapping visits, future times and finalized salary months are blocked. Regular schedule and whole-hour salary rules still apply; approve overtime separately for work outside the regular shift.

The Telegram bot sends active admins and super admins check-in and checkout alerts, with employee name and date/time in Tashkent. Check-in includes the assigned shift; checkout includes this visit's actual duration. Admin request, forgotten-checkout and daily-review alerts go to both roles too. Alerts are delivered by the minute notification job. Send `/start` to the bot and keep notifications enabled; `/stop` disables delivery. Attendance is still recorded if Telegram delivery fails.

Use **Team → Telegram messages** to select an active user, write a personal message and send it privately through the bot. The recipient must have started the bot and enabled notifications. Your name is included as the sender. Your recent-message list shows queued, sending, sent, failed or unconfirmed delivery; sent confirms Telegram acceptance, not reading. Do not automatically resend an unconfirmed message.

Select multiple recipient checkboxes to send the same message to several people. **Choose everybody** selects all active users who can receive bot messages, even outside the current name search. Uncheck anyone to exclude them, or use **Clear selection** to start again. Unavailable bot users cannot be selected. Each recipient receives a private copy; large groups may take several minutes to deliver.

Salary counts completed payable hours per employee per day. Credited regular time and approved overtime are combined before rounding down; partial hours do not carry forward. Exact attendance and eligible time remain visible separately from **Paid hours**. For an eight-hour extended-rate threshold, 9h 30m eligible time earns eight normal hours plus one extended-rate hour. Open months use this rule; finalized versions keep their original calculations unless explicitly reopened.

Take private backups before releases and on an agreed schedule, and rehearse restores. See [deployment and recovery](RELEASE_RUNBOOK.md). Restrict CSVs and backups to payroll staff. Review Worker errors, failed/uncertain outbox counts, forgotten checkouts and unresolved review queues. Agree backup retention and off-machine storage with the owner; this repository does not create an external backup service.
