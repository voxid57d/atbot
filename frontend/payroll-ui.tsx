import { openSalaryTask } from "./salary-review-flow";
import { FineDecision, DecisionStamp, type StoredFineDecision } from "./fine-decision";
import {
  salaryTaskLabel,
  canReviewTask,
  orderedSalaryTasks,
  finalizationBlockers,
  type SalaryWarning,
} from "./salary-tasks";
import { EmployeeFocus } from "./employee-focus";
import { navigateTo, selectionFor, setSalaryReview } from "./navigation";
import { MonthPicker, monthName } from "./month-picker";
import { MoreOptions } from "./more-options";
import { useEffect, useState } from "react";
import { EmployeeVisibility } from "./employee-visibility";
import {
  Form,
  Field,
  ErrorNotice,
  useResource,
  hours,
  clock,
  ShiftAttendanceDetails,
  type ShiftAttendance,
} from "./ui";
import { currentLaunchData } from "./api";
import { t } from "./text";
import { localDate, formatMoney } from "../shared/domain";
import type { PayrollAdjustment } from "../shared/payroll";
import type { CashierBonus } from "../shared/debtors";
type Adjustment = PayrollAdjustment & {
  employee_id: string;
  decision_reason: string | null;
};
type Fine = {
  id: string;
  work_date: string;
  reason: string;
  category: string;
  ordinal: number;
  status: string;
  proposedFine: number | null;
  progressionToken: string;
  fineDecision: { status: string; amount: number; reason: string; decided_at?: number; decided_by_name?: string | null } | null;
};
type Entry = {
  employeeId: string;
  fullName: string;
  role: string | null;
  level: string | null;
  actualSeconds: number;
  paidSeconds?: number;
  regularSeconds: number;
  overtimeSeconds: number;
  basePay: number;
  overtimePay: number;
  workedGross: number;
  cashierBonus?: CashierBonus | null;
  bonuses: number;
  leavePay: number;
  deductions: number;
  advances: number;
  fines: number;
  finalPay: number;
  adjustments: Adjustment[];
  violations: Fine[];
  rates: {
    effective: number;
    hourlyRate: number | null;
    dailyRule?: { thresholdMinutes: number; hourlyRate: number } | null;
  }[];
  days: {
    shiftAttendance?: ShiftAttendance[];
    date: string;
    actualSeconds: number;
    openSessions?: number;
    paidSeconds?: number;
    regularSeconds: number;
    overtimeSeconds: number;
    grossEstimate: number;
    thresholdSeconds?: number;
    shifts?: {
      id: string;
      start_at: number;
      end_at: number;
      kind: string;
      status: string;
    }[];
    sessions?: { id: string; check_in: number; check_out: number | null }[];
  }[];
};
type Data = {
  fineDecisions?: StoredFineDecision[];
  disabledEmployeeIds: string[];
  id: string;
  period: { from: string; to: string };
  status: string;
  snapshotVersion: number;
  revision: number;
  entries: Entry[];
  warnings: SalaryWarning[];
  totalPay: number;
  adjustments: Adjustment[];
  payrollStartDay: number;
};
const get = (f: FormData, key: string) => String(f.get(key) ?? "");
function Reason() {
  return <Field label="reason" name="reason" />;
}
function AdjustmentDecision({ adjustment, revision, onSaved }: {
  adjustment: Adjustment; revision: number; onSaved: () => Promise<void>;
}) {
  return <Form path={`/payroll/adjustments/${adjustment.id}/decision`}
    version={JSON.stringify([adjustment.status, adjustment.amount, adjustment.decision_reason])}
    build={(f) => ({ status: get(f, "status"), revision, reason: get(f, "reason") })}
    onSaved={onSaved} submitLabel="approveAdjustment">
    <label>{t("decision")}<select name="status" defaultValue={adjustment.status === "approved" ? "reversed" : "approved"}>
      {adjustment.status === "approved" ? <option value="reversed">{t("reverseAdjustment")}</option>
        : <><option value="approved">{t("approve")}</option><option value="rejected">{t("reject")}</option></>}
    </select></label>
    <Reason />
  </Form>;
}
function Breakdown({
  entry,
  showAdjustments = true,
}: {
  entry: Entry;
  showAdjustments?: boolean;
}) {
  return (
    <>
      <dl className="payroll-breakdown">
        {(
          [
            [t("actualTime"), hours(entry.actualSeconds)],
            [
              "Paid hours",
              hours(
                entry.paidSeconds ??
                  entry.regularSeconds + entry.overtimeSeconds,
              ),
            ],
            [t("paidRegular"), hours(entry.regularSeconds)],
            [t("approvedOvertime"), hours(entry.overtimeSeconds)],
            [t("basePay"), formatMoney(entry.basePay)],
            [t("overtimePay"), formatMoney(entry.overtimePay)],
            ...(entry.cashierBonus ? [
              ["Earnings eligible for debt bonus", formatMoney(entry.cashierBonus.eligibleEarnings)],
              ["Debt multiplier", entry.cashierBonus.percentage === null ? "Awaiting debtor data" : `${entry.cashierBonus.percentage.toFixed(2)}% · ${entry.cashierBonus.multiplier}×`],
              ["Cashier debt bonus (included in bonuses)", formatMoney(entry.cashierBonus.amount)],
            ] : []),
            [t("bonus"), formatMoney(entry.bonuses)],
            [t("leave_pay"), formatMoney(entry.leavePay)],
            [t("deduction"), formatMoney(entry.deductions)],
            ...(entry.advances
              ? [["Historical advance adjustment", formatMoney(entry.advances)]]
              : []),
            [t("fineDeductions"), formatMoney(entry.fines)],
            [t("finalPay"), formatMoney(entry.finalPay)],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {entry.paidSeconds !== undefined && (
        <p>
          Regular credited time and approved overtime are combined each day.
          Only completed hours count toward salary. Time within 5 minutes of the
          next hour counts as that hour; other leftover minutes do not carry
          forward.
        </p>
      )}
      <details className="review-section">
        <summary>{t("historicalRates")}</summary>
        {entry.rates.map((r) => (
          <p key={r.effective}>
            {localDate(r.effective * 1000)} ·{" "}
            {r.hourlyRate === null
              ? t("notConfigured")
              : formatMoney(r.hourlyRate)}{" "}
            / hour
            {r.dailyRule && (
              <small>
                {" "}
                · After {hours(r.dailyRule.thresholdMinutes * 60)} each day:{" "}
                {formatMoney(r.dailyRule.hourlyRate)} / hour
              </small>
            )}
          </p>
        ))}
      </details>
      <details className="review-section">
        <summary>{t("attendanceHistory")}</summary>
        {entry.days
          .filter(
            (d) =>
              d.actualSeconds ||
              d.regularSeconds ||
              d.overtimeSeconds ||
              d.shifts?.some((s) => s.status === "scheduled"),
          )
          .map((d) => (
            <article className="payroll-day" key={d.date}>
              <header>
                <strong>{d.date}</strong>
                <span>{formatMoney(d.grossEstimate)}</span>
              </header>
              <dl className="payroll-day-times">
                {d.paidSeconds !== undefined && (
                  <div>
                    <dt>Paid hours</dt>
                    <dd>{hours(d.paidSeconds)}</dd>
                  </div>
                )}
                {!!d.thresholdSeconds && (
                  <div>
                    <dt>Time at extended-hours rate</dt>
                    <dd>{hours(d.thresholdSeconds)}</dd>
                  </div>
                )}
                <div>
                  <dt>Scheduled</dt>
                  <dd>
                    {d.shifts === undefined
                      ? "Unavailable for this period"
                      : d.shifts.filter((s) => s.status === "scheduled").length
                        ? d.shifts
                            .filter((s) => s.status === "scheduled")
                            .map((s) => (
                              <span key={s.id}>
                                {clock(s.start_at).slice(0, 5)} –{" "}
                                {clock(s.end_at).slice(0, 5)} · {s.kind}
                              </span>
                            ))
                        : "No scheduled shift"}
                  </dd>
                </div>
                <div>
                  <dt>Recorded attendance</dt>
                  <dd>
                    {d.sessions === undefined
                      ? hours(d.actualSeconds)
                      : d.sessions.length
                        ? d.sessions.map((s) => (
                            <span key={s.id}>
                              {clock(s.check_in)} –{" "}
                              {s.check_out === null
                                ? t("openSession")
                                : clock(s.check_out)}
                            </span>
                          ))
                        : "No recorded attendance"}
                  </dd>
                </div>
                <div>
                  <dt>{t("paidRegular")}</dt>
                  <dd>{hours(d.regularSeconds)}</dd>
                </div>
                <div>
                  <dt>{t("approvedOvertime")}</dt>
                  <dd>{hours(d.overtimeSeconds)}</dd>
                </div>
              </dl>
              <ShiftAttendanceDetails rows={d.shiftAttendance} />
            </article>
          ))}
      </details>
      {showAdjustments && (
        <details className="review-section">
          <summary>{t("adjustmentQueue")}</summary>
          {entry.adjustments.map((a) => (
            <article className="request-card" key={a.id}>
              <strong>
                {t(a.kind)} · {formatMoney(a.amount)} · {a.status}
              </strong>
              <p>
                {a.work_date} · {a.reason}
              </p>
              {a.decision_reason && <p>{a.decision_reason}</p>}
            </article>
          ))}
        </details>
      )}
      {showAdjustments && <details className="review-section">
        <summary>Fine decision history</summary>
        {entry.violations
          .filter((v) => v.fineDecision)
          .map((v) => (
            <p key={v.id}>
              {v.work_date} · {v.category} · {v.fineDecision!.status} ·{" "}
              {formatMoney(v.fineDecision!.amount)} · {v.fineDecision!.reason}
            </p>
          ))}
      </details>}
    </>
  );
}
export function PayrollScreen({
  canApprove,
  canAttendance,
  canRates,
  superAdmin = false,
}: {
  canApprove: boolean;
  canAttendance: boolean;
  canRates: boolean;
  superAdmin?: boolean;
}) {
  const [periodDate, setPeriodDate] = useState(
    selectionFor("payroll")?.date ?? localDate(),
  );
  const [showDisabled, setShowDisabled] = useState(
    !!selectionFor("payroll")?.employeeId,
  );
  const [downloadError, setDownloadError] = useState("");
  const { data, error, loading, reload } = useResource<Data>(
    `/payroll/preview?periodDate=${periodDate}`,
    30,
  );
  const name = (id: string) =>
    data?.entries.find((e) => e.employeeId === id)?.fullName ??
    "selected employee";
  const visible = (id: string) =>
    showDisabled || !data?.disabledEmployeeIds.includes(id);
  const visibleEntries =
    data?.entries.filter(
      (e) =>
        visible(e.employeeId) &&
        (!selectionFor("payroll")?.employeeId ||
          e.employeeId === selectionFor("payroll")?.employeeId),
    ) ?? [];
  const reviewPermissions = {
    attendance: canAttendance,
    rates: canRates,
    approve: canApprove,
    superAdmin,
  };
  const disabledCount =
    data?.entries.filter((e) => data.disabledEmployeeIds.includes(e.employeeId))
      .length ?? 0;
  const hiddenTasks =
    data?.warnings.filter((w) => !visible(w.employeeId)).length ?? 0;
  const blockers = data
    ? finalizationBlockers(
        data.period.to,
        localDate(),
        data.warnings.length,
        data.entries.length,
        data.entries.reduce((n, e) => n + e.days.reduce((sum, d) => sum + (d.openSessions ?? 0), 0), 0),
      )
    : [];
  function beginReview(entry: Entry, task: SalaryWarning) {
    setSalaryReview({
      employeeId: entry.employeeId,
      name: entry.fullName,
      periodDate,
    });
    openSalaryTask(task);
  }
  useEffect(() => {
    const target = selectionFor("payroll");
    if (!data || !target?.employeeId || !target.taskKind) return;
    const card = document.querySelector(
      `[data-employee-id="${target.employeeId}"]`,
    );
    const tasks = card?.querySelector<HTMLDetailsElement>(
      "[data-review-tasks]",
    );
    if (!tasks) return;
    tasks.open = true;
    let destination: Element | null | undefined = tasks.querySelector(
      `[data-task-kind="${target.taskKind}"][data-task-date="${target.date}"]`,
    );
    if (["paid_leave", "negative_pay"].includes(target.taskKind)) {
      const composer = document.getElementById(
        "salary-adjustments",
      ) as HTMLDetailsElement | null;
      if (composer) {
        composer.open = true;
        const person = composer.querySelector(
          'select[name="employeeId"]',
        ) as unknown as { value: string } | null;
        const date =
          composer.querySelector<HTMLInputElement>('input[name="date"]');
        const kind = composer.querySelector(
          'select[name="kind"]',
        ) as unknown as { value: string } | null;
        if (person) person.value = target.employeeId;
        if (date && target.date) date.value = target.date;
        if (kind && target.taskKind === "paid_leave") kind.value = "leave_pay";
        destination = composer;
      }
    }
    if (target.taskKind === "pending_adjustment") {
      const adjustments =
        tasks.querySelector<HTMLElement>("[data-adjustments]");
      if (adjustments) {
        destination = adjustments;
      }
    }
    if (target.taskKind === "fine_approval")
      destination =
        tasks.querySelector(target.subjectId ? `[data-fine-id="${target.subjectId}"]` : `[data-fine-date="${target.date}"]`) ?? destination;
    destination?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data?.period.from]);
  async function download() {
    setDownloadError("");
    try {
      const launch = currentLaunchData(),
        r = await fetch(`/api/payroll/export?periodDate=${periodDate}`, {
          credentials: "same-origin",
          headers: launch ? { "X-Telegram-Init-Data": launch } : {},
        });
      if (!r.ok)
        throw new Error(
          ((await r.json()) as { error?: string }).error ?? "Export failed.",
        );
      const blob = await r.blob();
      if (launch !== currentLaunchData())
        throw new Error("Your Telegram account changed. Reopen the Mini App.");
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `ielts-zone-payroll-${data!.period.from}-v${data!.snapshotVersion}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    }
  }
  return (
    <div className="attendance-stack monthly-salaries">
      <EmployeeFocus
        page="payroll"
        name={name(selectionFor("payroll")?.employeeId ?? "")}
      />
      <div className="filter-bar">
        <MonthPicker
          value={periodDate}
          onChange={(date) => {
            setSalaryReview();
            navigateTo("payroll", selectionFor("payroll")?.employeeId, date);
          }}
        />
        <MoreOptions>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void reload()}
          >
            {t("refresh")}
          </button>
        </MoreOptions>
      </div>
      <ErrorNotice error={error || downloadError} />
      {!data && <p>{t("loading")}</p>}
      {data && (
        <>
          <section className="panel attendance-panel salary-month-summary">
            <div className="request-heading">
              <div>
                <strong>{monthName(data.period.from)}</strong>
                <p className="muted">
                  {data.period.from} - {data.period.to}
                </p>
              </div>
              <span
                className={`badge ${data.status === "finalized" ? "status-good" : "status-attention"}`}
              >
                {data.status === "finalized" ? "Finalized" : "Current estimate"}
              </span>
            </div>
            <small>Total calculated salary</small>
            <h2>{formatMoney(data.totalPay)}</h2>
            <p className="muted">
              {data.status === "finalized"
                ? "Approved salary figures for this month."
                : "Calculated so far. Figures can change until this month is finalized."}
            </p>
            {!!disabledCount && (
              <div className="salary-disabled-note">
                <span>
                  Includes {disabledCount} disabled{" "}
                  {disabledCount === 1 ? "employee" : "employees"}.
                  {hiddenTasks > 0
                    ? ` ${hiddenTasks} hidden review tasks remain.`
                    : ""}
                </span>
                <EmployeeVisibility
                  showDisabled={showDisabled}
                  onChange={setShowDisabled}
                  disabledCount={disabledCount}
                />
              </div>
            )}
            {data.status === "finalized" && (
              <button className="secondary" onClick={() => void download()}>
                {t("exportPayroll")}
              </button>
            )}
          </section>
          <div className="salary-card-list">
            {visibleEntries.map((entry) => {
              const tasks =
                data.status === "open"
                  ? orderedSalaryTasks(
                      data.warnings.filter(
                        (w) => w.employeeId === entry.employeeId,
                      ),
                    )
                  : [];
              const next = tasks.find((w) =>
                canReviewTask(w, reviewPermissions),
              );
              const savedFines = data.fineDecisions?.filter((f) => f.employee_id === entry.employeeId)
                ?? entry.violations.filter((v) => v.fineDecision).map((v) => ({ ...v.fineDecision!,
                  violation_id: v.id, employee_id: entry.employeeId, work_date: v.work_date, progression_token: v.progressionToken }));
              return (
                <section
                  data-employee-id={entry.employeeId}
                  className="employee-card payroll-employee-card salary-person-card"
                  key={`${data.period.from}:${entry.employeeId}`}
                >
                  <header className="salary-person-heading">
                    <div>
                      <h3>{entry.fullName}</h3>
                      <p className="muted">
                        {entry.role ?? "Employee"}
                        {entry.level ? ` · ${entry.level}` : ""}
                      </p>
                    </div>
                    <span
                      className={`badge ${tasks.length ? "status-attention" : "status-good"}`}
                    >
                      {data.status === "finalized"
                        ? "Finalized"
                        : tasks.length
                          ? `Needs review · ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`
                          : entry.days.some((d) => d.openSessions) ? "In progress" : "Ready"}
                    </span>
                  </header>
                  {entry.days.some((d) => d.openSessions) && (
                    <p className="muted">In progress - pay pending checkout. Open sessions are excluded from calculated salary.</p>
                  )}
                  <div className="salary-person-amount">
                    <small>Calculated salary</small>
                    <strong>{formatMoney(entry.finalPay)}</strong>
                  </div>
                  <div className="employee-pay-summary">
                    <span>
                      Recorded duration: <strong>{hours(entry.actualSeconds)}</strong>
                    </span>
                    <span>
                      Paid hours:{" "}
                      <strong>
                        {hours(
                          entry.paidSeconds ??
                            entry.regularSeconds + entry.overtimeSeconds,
                        )}
                      </strong>
                    </span>
                  </div>
                  <details className="review-section salary-breakdown">
                    <summary>Salary breakdown</summary>
                    <Breakdown entry={entry} showAdjustments={false} />
                  </details>
                  <details
                    className="review-section salary-review-tasks"
                    data-review-tasks
                  >
                    <summary>Pending ({tasks.length})</summary>
                    {!tasks.length && (
                      <p>
                        {data.status === "finalized"
                          ? "This month's figures are finalized."
                          : "No outstanding salary review tasks for this employee."}
                      </p>
                    )}
                    {data.status === "open" &&
                      tasks.map((w, index) => (
                        <article
                          className="request-card salary-task"
                          data-task-kind={w.kind}
                          data-task-date={w.date}
                          key={w.id ?? `${w.employeeId}:${w.date}:${w.kind}:${index}`}
                        >
                          <strong>
                            {salaryTaskLabel(w.kind)} - {w.date}
                          </strong>
                          <p>{w.message}</p>
                          {w.blockedBy && <p className="notice">{w.blockedBy}</p>}
                          {!canApprove && ["fine_approval", "pending_adjustment", "unapproved_overtime", "unworked_day"].includes(w.kind) && <p className="muted">A payroll approver must decide this task.</p>}
                          {!["fine_approval", "pending_adjustment", "unapproved_overtime", "unworked_day"].includes(w.kind) && <button
                            className="text-button"
                            disabled={!canReviewTask(w, reviewPermissions)}
                            onClick={() => beginReview(entry, w)}
                          >
                            {canReviewTask(w, reviewPermissions)
                              ? "Review this task"
                              : w.state === "blocked" ? "Waiting" : w.kind === "fine_configuration" ? "Super administrator needed" : "Another administrator's permission is needed"}
                          </button>}
                          {w.kind === "fine_approval" && canReviewTask(w, reviewPermissions) && entry.violations
                            .filter((v) => v.id === w.subjectId || (!w.subjectId && v.work_date === w.date && !v.fineDecision))
                            .map((v) => <div key={v.id} data-fine-id={v.id} data-fine-date={v.work_date}>
                              <p>{v.category} · {v.reason} · {formatMoney(v.proposedFine ?? 0)}</p>
                              <FineDecision fine={v} revision={data.revision} periodDate={periodDate} onSaved={reload} />
                            </div>)}
                          {w.kind === "pending_adjustment" && canApprove && entry.adjustments
                            .filter((a) => a.status === "pending" && (a.id === w.subjectId || (!w.subjectId && a.work_date === w.date)))
                            .map((a) => <div key={a.id} data-adjustments>
                              <p>{t(a.kind)} · {formatMoney(a.amount)} · {a.reason}</p>
                              <AdjustmentDecision adjustment={a} revision={data.revision} onSaved={reload} />
                            </div>)}
                          {canApprove &&
                            ["unapproved_overtime", "unworked_day"].includes(
                              w.kind,
                            ) && (
                              <Form
                                path="/payroll/resolutions"
                                build={(f) => ({
                                  periodDate,
                                  revision: data.revision,
                                  employeeId: w.employeeId,
                                  date: w.date,
                                  kind: w.kind,
                                  reason: get(f, "reason"),
                                })}
                                onSaved={reload}
                                submitLabel={
                                  w.kind === "unworked_day"
                                    ? "confirmUnworked"
                                    : "excludeOvertime"
                                }
                              >
                                <p>{t("payrollResolutionHelp")}</p>
                                <Reason />
                              </Form>
                            )}
                        </article>
                      ))}
                  </details>
                  <details className="review-section salary-decision-history">
                    <summary>History ({entry.adjustments.filter((a) => a.status !== "pending").length + savedFines.length})</summary>
                    {entry.adjustments.filter((a) => a.status !== "pending").map((a) => (
                      <article className="request-card" key={a.id}>
                        <strong>{a.work_date} · {t(a.kind)} · {a.status} · {formatMoney(a.amount)}</strong>
                        {a.reason && <p>{a.reason}</p>}
                        {a.decision_reason && <p>{a.decision_reason}</p>}
                        {canApprove && data.status === "open" && a.status === "approved" && (
                          <details className="review-section"><summary>Change decision</summary>
                            <AdjustmentDecision adjustment={a} revision={data.revision} onSaved={reload} />
                          </details>
                        )}
                      </article>
                    ))}
                    {savedFines.map((f) => {
                      const current = entry.violations.find((v) => v.id === f.violation_id && v.progressionToken === f.progression_token && v.fineDecision);
                      return <article className="request-card" key={f.violation_id}>
                        <strong>{f.work_date} · {current?.category ?? "Fine"} · {f.status} · {formatMoney(f.amount)}</strong>
                        {f.reason && <p>{f.reason}</p>}
                        <DecisionStamp decision={f} />
                        {!current && <p className="muted">Superseded by changed attendance, discipline or policy. This decision is not applied.</p>}
                        {current && current.ordinal > 0 && canApprove && data.status === "open" && <FineDecision fine={current} revision={data.revision} periodDate={periodDate} onSaved={reload} />}
                      </article>;
                    })}
                    {!entry.adjustments.some((a) => a.status !== "pending") && !savedFines.length && <p>No completed financial decisions in this period.</p>}
                  </details>
                  {next && (
                    <button
                      className="primary salary-next-task"
                      onClick={() => beginReview(entry, next)}
                    >
                      Review next task
                    </button>
                  )}
                  {tasks.length > 0 && !next && (
                    <p className="muted">
                      {tasks.every((w) => w.state === "blocked") ? "These reviews are waiting for their prerequisites." : "These tasks need another administrator's permission."}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
          {!visibleEntries.length && (
            <p>
              {data.entries.length
                ? "No employees match this view."
                : "No employee salary records for this month."}
            </p>
          )}
          {data.status === "open" && (
            <>
              <details
                key={data.period.from}
                id="salary-adjustments"
                className="panel attendance-panel request-composer"
              >
                <summary>{t("payrollAdjustment")}</summary>
                <p>{t("adjustmentHelp")}</p>
                <Form
                  path="/payroll/adjustments"
                  build={(f) => ({
                    employeeId: get(f, "employeeId"),
                    date: get(f, "date"),
                    kind: get(f, "kind"),
                    amount: Number(get(f, "amount")),
                    revision: data.revision,
                    reason: get(f, "reason"),
                  })}
                  onSaved={reload}
                >
                  <label>
                    {t("name")}
                    <select
                      name="employeeId"
                      required
                      defaultValue={selectionFor("payroll")?.employeeId ?? ""}
                    >
                      <option value="">{t("chooseEmployee")}</option>
                      {visibleEntries.map((e) => (
                        <option value={e.employeeId} key={e.employeeId}>
                          {e.fullName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    label="workDate"
                    name="date"
                    type="date"
                    value={periodDate}
                  />
                  <label>
                    {t("adjustmentKind")}
                    <select name="kind">
                      {(["bonus", "deduction", "leave_pay"] as const).map(
                        (kind) => (
                          <option value={kind} key={kind}>
                            {t(kind)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <Field label="adjustmentAmount" name="amount" type="number" />
                  <Reason />
                </Form>
              </details>
              <section
                className="panel attendance-panel salary-finalize"
                aria-label="Finalize month"
              >
                <h2>Finalize month</h2>
                <p>Save and lock this month's salary figures.</p>
                {blockers.length > 0 || !canApprove ? (
                  <>
                    <button className="primary" disabled>
                      Finalize month
                    </button>
                    <div className="salary-finalize-reasons">
                      {blockers.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                      {!canApprove && (
                        <p>A payroll approver must finalize this month.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <Form
                    path="/payroll/finalize"
                    build={(f) => ({
                      periodDate,
                      revision: data.revision,
                      reason: get(f, "reason"),
                    })}
                    onSaved={reload}
                    submitLabel="finalizePayroll"
                  >
                    <Reason />
                  </Form>
                )}
              </section>
            </>
          )}
          {canApprove && data.status === "finalized" && (
            <details className="panel attendance-panel request-composer">
              <summary>{t("reopenPayroll")}</summary>
              <p>{t("reopenHelp")}</p>
              <Form
                path="/payroll/reopen"
                build={(f) => ({
                  periodDate,
                  revision: data.revision,
                  reason: get(f, "reason"),
                })}
                onSaved={reload}
                submitLabel="reopenPayroll"
              >
                <Reason />
              </Form>
            </details>
          )}{" "}
        </>
      )}
    </div>
  );
}
export function SalaryHistory() {
  const [month, setMonth] = useState(localDate());
  const current = useResource<{
    period: { from: string; to: string };
    status: string;
    entry: Entry | null;
    warnings: { message: string }[];
  }>(`/payroll/mine?periodDate=${month}`, 60);
  const { data, error, loading, reload } = useResource<{
    snapshots: {
      periodId: string;
      version: number;
      period: { from: string; to: string };
      approvedAt: number;
      periodStatus: string;
      isCurrent: boolean;
      entry: Entry;
    }[];
  }>("/payroll/history");
  return (
    <div className="attendance-stack">
      <MonthPicker value={month} onChange={setMonth} />
      <ErrorNotice error={current.error} />
      {current.data && (
        <section className="employee-card payroll-employee-card">
          <header className="employee-card-heading">
            <h2>{monthName(current.data.period.from)}</h2>
            <strong>{formatMoney(current.data.entry?.finalPay ?? 0)}</strong>
          </header>
          <p>
            {current.data.period.from} - {current.data.period.to} -{" "}
            {current.data.status === "finalized"
              ? "Finalized salary"
              : "Provisional salary calculation"}
          </p>
          <p className="muted">
            Salary figures only. Payments are handled in the separate LMS.
          </p>
          {current.data.entry?.days.some((d) => d.openSessions) && (
            <p className="muted">In progress - pay pending checkout. Open sessions are excluded from calculated salary.</p>
          )}
          {!!current.data.warnings.length && (
            <p className="notice">
              {current.data.warnings.length} item(s) still need administrator
              review. This month's figures may change.
            </p>
          )}
          {current.data.entry ? (
            <details className="review-section">
              <summary>Salary breakdown and attendance</summary>
              <Breakdown entry={current.data.entry} />
            </details>
          ) : (
            <p>No salary records for this month.</p>
          )}
        </section>
      )}
      <details className="panel attendance-panel">
        <summary>Finalized salary history</summary>
        <ErrorNotice error={error} />
        <button className="secondary" onClick={() => void reload()}>
          {t("refresh")}
        </button>
        {loading && <p>{t("loading")}</p>}
        {data && !data.snapshots.length && <p>{t("noSalaryHistory")}</p>}
        {data?.snapshots.map((s) => (
          <details
            className="panel attendance-panel request-composer"
            key={`${s.periodId}:${s.version}`}
          >
            <summary>
              {s.period.from} — {s.period.to} · {formatMoney(s.entry.finalPay)}
            </summary>
            <p>
              {t("snapshotVersion")}: {s.version} ·{" "}
              {!s.isCurrent
                ? t("snapshotPrevious")
                : s.periodStatus === "finalized"
                  ? t("payrollFinalized")
                  : t("payrollReopened")}
            </p>
            <Breakdown entry={s.entry} />
          </details>
        ))}
      </details>
    </div>
  );
}
