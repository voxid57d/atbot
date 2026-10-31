# Cashier debt bonus

Available from **15 October 2026**. Under **Roles & rates → Cashier**, add a level and its hourly rate. In **Employees**, add or edit the person and choose that Cashier level with its effective date. Cashier is the existing job role (`cashier`), not an administrator permission. Do not promote cashiers to administrators to enable this section.

**Debtors & cashier bonus** is visible to cashiers, administrators and super administrators. Those groups can save the seven counts from the supplied calculator: current debtors, debtors over one month, archive debtors, finished debtors, students, archive students and finished students. Ordinary employees cannot read or write this section through the API. Cashiers continue to receive only their own salary through the existing employee salary endpoints. Administrator access to other people's salaries still requires salary-management or payroll-approval permission.

The percentage is the sum of the four debtor counts divided by the sum of the three student counts, multiplied by 100. Counts must be nonnegative integers; student totals must be positive. Number fields clear a default zero on focus and remove leading zeros while typing; leaving a field empty restores zero on blur. Each save uses today's Tashkent date and records the author in the audit log. Multiple saves per day are allowed, but **only the last save is that day's active record** in the chart, history and salary calculation. Earlier saves remain immutable audit records. A day cannot be edited through a later day's input. Refresh before saving after a conflicting update. Repeated submissions with the same operation key create only one entry.

| Debt percentage | Salary multiplier |
| --- | --- |
| Exactly 0% | 2.5× |
| Above 0%, below 2% | 2.0× |
| 2% to below 5% | 1.8× |
| 5% to below 7% | 1.7× |
| 7% to below 10% | 1.6× |
| 10% to below 15% | 1.5× |
| 15% to below 20% | 1.4× |
| 20% to below 30% | 1.2× |
| 30% and above | 1.0× (no bonus) |

Bands use unrounded counts, so a displayed rounded percentage never controls the multiplier. UZS bonus amounts round to the nearest integer, with halves rounding up.

The latest entered percentage is shared by all cashiers. Each cashier's bonus is calculated separately using their own eligible earnings for the **whole payroll month, starting on day 1**. Only earnings while assigned as a cashier count; earnings in another role are excluded. The feature launched on 15 October 2026, but October's bonus includes cashier earnings from **1 October**, not just work from the launch date onward. Months before October 2026 and finalized snapshots remain unchanged. The latest percentage updates the open month's bonus; daily percentages are not averaged or assigned individually to workdays. Entries remain in effect until replaced, including across month boundaries. Historical months use the latest entry on or before their month end.

Eligible earnings include recorded attendance, approved overtime and the role's historical extended-hours rate. The employee's historical role assignment determines which workdays count as cashier work. Existing completed-hour and historical-rate rules remain in effect.

**Debt bonus = eligible cashier earnings × (multiplier − 1).** Payroll adds this amount to approved manual bonuses. Paid leave, other bonuses, fines, deductions and historical advances do not affect the bonus base. Existing deductions apply afterward. For example, 2,000,000 UZS of eligible earnings at 8% debt produces a 1,200,000 UZS bonus and 3,200,000 UZS before deductions.

Cashiers see their current salary and bonus in this section and the full breakdown in **My salary**. Administrators with salary-management or payroll-approval permission also see a separate breakdown for each active cashier here, even when the administrator has no cashier employee profile. Each breakdown explains open attendance sessions, missing historical rates, zero eligible earnings and debt levels that produce no bonus. The daily chart and history show only the latest saved point for each day. History comparisons apply each daily multiplier to the cashier's **current** eligible earnings; they are comparisons of debt performance, not historical salary snapshots. The section refreshes every minute and immediately after a save.

Monthly payroll includes the bonus breakdown and its source entry ID in its immutable snapshot and CSV. A missing debt entry blocks finalization when there are cashier earnings. A payroll approver must review and finalize using the existing month-end process. Once finalized, new debt entries cannot change that month's snapshot; a super administrator must reopen a locked month before corrections. Cashiers cannot approve or finalize payroll.

Deploy migration `0011_cashier_debt_bonus.sql` before the updated Worker. It adds only the debtor history table, revision and lock guards; it does not seed debt figures, rates, or employees. Take the usual private production backup before applying a remote migration.
