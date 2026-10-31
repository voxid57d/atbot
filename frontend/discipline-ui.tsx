import { navigateTo, selectionFor } from "./navigation";
import { MonthPicker } from "./month-picker";
import { MoreOptions } from "./more-options";
import { EmployeeCards } from "./employee-cards";
import { EmployeeVisibility } from "./employee-visibility";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Form, Field, ErrorNotice, useResource, hours } from "./ui";
import { t } from "./text";
import { formatMoney, localDate } from "../shared/domain";
import type { ReviewTask } from "../shared/review-tasks";
import type { Shift, Session } from "../shared/attendance";
import { clock, ShiftAttendanceDetails, type ShiftAttendance } from "./ui";
import { FineDecision, DecisionStamp, type FineReview, type StoredFineDecision } from "./fine-decision";
import type {
  DisciplinePolicy,
  DisciplineViolation,
} from "../shared/discipline";
type Uniform = {
  status: string;
  declared_at: number | null;
  declared_has_uniform: number;
  admin_has_uniform: number | null;
  decision_reason: string | null;
};
type Day = {
  employee_id: string;
  work_date: string;
  open_sessions: number;
  qualityPending: boolean;
  attendance_snapshot: string;
  inProgress: boolean;
  actualSeconds: number;
  regularSeconds: number;
  overtimeSeconds: number;
  paidSeconds: number;
  shifts: Shift[];
  sessions: Session[];
  shiftAttendance?: ShiftAttendance[];
  quality: { rating: string; comment: string } | null;
  uniform: Uniform | null;
};
type Violation = DisciplineViolation & FineReview & {
  fineReviewed: boolean;
  meeting: { reason: string; completed_at: number } | null;
};
type Data = {
  fineDecisions: StoredFineDecision[];
  tasks: ReviewTask[];
  history: {
    violation_id: string;
    source_token: string;
    employee_id: string;
    work_date: string;
    category: string;
    reason: string;
  }[];
  revision: number;
  period: { from: string; to: string };
  policy: DisciplinePolicy;
  policyId: number;
  days: Day[];
  violations: Violation[];
  people: { id: string; full_name: string; active: number }[];
  early: {
    shiftId: string;
    employee_id: string;
    work_date: string;
    missedSeconds: number;
    sourceToken: string;
    review: { status: string; reason: string } | null;
  }[];
  locks: { from_date: string; to_date: string }[];
  requests: {
    id: string;
    employee_id: string;
    kind: string;
    work_date: string;
    reason: string;
  }[];
  openAttendance: {
    id: string;
    employee_id: string;
    work_date: string;
    check_in: number;
  }[];
  summary: {
    mandatoryPending: number;
    meetingPending: number;
    countedViolations: number;
    proposedFineTotal: number;
    unconfiguredFines: number;
  };
};
const get = (f: FormData, key: string) => String(f.get(key) ?? "");
export function UniformToday() {
  const [correcting, setCorrecting] = useState(false);
  const { data, error, reload } = useResource<{
    revision: number;
    today: string;
    uniform: Uniform | null;
    worked: boolean;
  }>("/discipline/today", 30);
  return (
    <section className="panel attendance-panel">
      <h2>{t("uniformToday")}</h2>
      <ErrorNotice error={error} />
      <p>{t("uniformHelp")}</p>
      {data?.uniform?.admin_has_uniform != null && <p>
        Recorded by administrator: {data.uniform.admin_has_uniform ? "wearing uniform" : "no uniform"}. Review: {data.uniform.status}.
      </p>}
      {data?.uniform?.declared_at ? (
        <div>
          <p className="notice">
            {data.uniform.declared_has_uniform
              ? t("haveUniform")
              : t("noUniform")}
            . <strong>{data.uniform.status}</strong>
          </p>
          {data.uniform.decision_reason && (
            <p>{data.uniform.decision_reason}</p>
          )}
          {data.uniform.status === "pending" ? (
            <>
              <button
                className="text-button"
                onClick={() => setCorrecting((v) => !v)}
              >
                Correct my selection
              </button>
              {correcting && (
                <Form
                  path="/discipline/uniform"
                  build={(f) => ({
                    revision: data.revision,
                    hasUniform: String(f.get("hasUniform")) === "true",
                    amend: true,
                    reason: String(f.get("reason")),
                  })}
                  onSaved={async () => {
                    setCorrecting(false);
                    await reload();
                  }}
                >
                  <label>
                    Correct uniform choice
                    <select
                      name="hasUniform"
                      defaultValue={String(!!data.uniform.declared_has_uniform)}
                    >
                      <option value="true">I have my uniform</option>
                      <option value="false">I don't have a uniform</option>
                    </select>
                  </label>
                  <Reason />
                </Form>
              )}
            </>
          ) : (
            <small>
              Already reviewed. Ask your administrator to return this decision
              to pending before correcting your choice.
            </small>
          )}
        </div>
      ) : data?.worked ? (
        <div className="uniform-choices">
          <Form
            path="/discipline/uniform"
            build={() => ({ revision: data.revision, hasUniform: true })}
            onSaved={reload}
            submitLabel="haveUniform"
          />
          <Form
            path="/discipline/uniform"
            build={() => ({ revision: data.revision, hasUniform: false })}
            onSaved={reload}
            submitLabel="noUniform"
          />
        </div>
      ) : (
        <p>{data ? t("uniformCheckInFirst") : t("loading")}</p>
      )}
    </section>
  );
}
// Optional notes stay behind a link; a note is required for negative or changed decisions.
function Reason({ required = false }: { required?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!required && !open)
    return (
      <button type="button" className="text-button" onClick={() => setOpen(true)}>
        {t("addNote")}
      </button>
    );
  return (
    <label>
      {t(required ? "noteRequired" : "reviewReason")}
      <input name="reason" maxLength={1000} required={required} autoFocus={open} />
    </label>
  );
}
const uniformDefault = (d: Day) =>
  d.uniform && d.uniform.status !== "pending"
    ? d.uniform.status
    : d.uniform?.declared_at && !d.uniform.declared_has_uniform
      ? "rejected"
      : "approved";
const canApproveUniform = (d: Day) =>
  !d.uniform?.declared_at || !!d.uniform.declared_has_uniform;
// One form and one button for a pending workday. Defaults are the common outcome
// (Good, uniform approved); nothing is saved until the administrator confirms.
function DayReview({
  d,
  revision,
  onSaved,
  onTouched,
}: {
  d: Day;
  revision: number;
  onSaved: () => Promise<void>;
  onTouched: () => void;
}) {
  const quality = d.qualityPending && !d.inProgress,
    uniform = !d.uniform || d.uniform.status === "pending";
  const [rating, setRating] = useState(d.quality?.rating ?? "good"),
    [status, setStatus] = useState(uniformDefault(d));
  if (!quality && !uniform) return null;
  const negative = (quality && rating === "bad") || (uniform && status === "rejected");
  return (
    <Form
      version={JSON.stringify([d.attendance_snapshot, d.quality, d.uniform])}
      path="/discipline/days"
      build={(f) => ({
        revision,
        reason: get(f, "reason"),
        days: [
          {
            employeeId: d.employee_id,
            date: d.work_date,
            ...(quality ? { quality: { rating, comment: get(f, "reason") } } : {}),
            ...(uniform
              ? {
                  uniform: {
                    status,
                    ...(!d.uniform?.declared_at ? { hasUniform: status === "approved" } : {}),
                  },
                }
              : {}),
          },
        ],
      })}
      onSaved={onSaved}
      submitLabel="confirmDay"
    >
      <div className="day-review-choices" onChange={onTouched}>
        {quality && (
          <label>
            {t("qualityRating")}
            <select name="rating" value={rating} onChange={(e) => setRating(e.target.value)}>
              <option value="excellent">{t("excellent")}</option>
              <option value="good">{t("good")}</option>
              <option value="bad">{t("bad")}</option>
            </select>
          </label>
        )}
        {uniform && (
          <label>
            {t("uniformToday")}
            <select name="uniform" value={status} onChange={(e) => setStatus(e.target.value)}>
              {canApproveUniform(d) && <option value="approved">Approve / wearing uniform</option>}
              <option value="rejected">{t("missingUniform")}</option>
            </select>
          </label>
        )}
        <Reason key={String(negative)} required={negative} />
      </div>
    </Form>
  );
}
export function DisciplineScreen({
  admin = false,
  superAdmin = false,
  canPayroll = false,
  canApprove = false,
  onRequests,
  onAttendance,
}: {
  admin?: boolean;
  superAdmin?: boolean;
  canPayroll?: boolean;
  canApprove?: boolean;
  onRequests?: () => void;
  onAttendance?: () => void;
}) {
  const [periodDate, setPeriodDate] = useState(
      selectionFor("reviews")?.date ?? localDate(),
    ),
    [tab, setTab] = useState("queue"),
    [employeeFilter, setEmployeeFilter] = useState(
      selectionFor("reviews")?.employeeId ?? "",
    ),
    [showDisabled, setShowDisabled] = useState(
      !!selectionFor("reviews")?.employeeId,
    );
  const { data, error, loading, reload } = useResource<Data>(
    `/discipline/${admin ? "review" : "mine"}?periodDate=${periodDate}`,
    30,
  );
  const name = (id: string) =>
    data?.people.find((p) => p.id === id)?.full_name ?? id;
  const locked = (date: string) =>
    !!data?.locks.some((l) => date >= l.from_date && date <= l.to_date);
  const revision = data?.revision ?? 0;
  const visible = (row: { employee_id: string }) =>
    (!admin ||
      showDisabled ||
      !!data?.people.find((p) => p.id === row.employee_id)?.active) &&
    (!employeeFilter || row.employee_id === employeeFilter);
  const selectedDays = data?.days.filter(visible) ?? [];
  const selectedViolations = data?.violations.filter(visible) ?? [];
  const selectedTasks = data?.tasks.filter((task) => visible({ employee_id: task.employeeId })) ?? [];
  useEffect(() => {
    const target = selectionFor("reviews");
    if (!data || !target?.date) return;
    if (target.taskKind === "fine_configuration" && superAdmin) {
      const policy = document.getElementById("discipline-policy") as HTMLDetailsElement | null;
      if (policy) { policy.open = true; policy.scrollIntoView({ behavior: "smooth", block: "center" }); }
    } else document.querySelector(`[data-review-date="${target.date}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data?.period.from]);
  const summary = {
    countedViolations: selectedViolations.filter((v) => v.ordinal > 0).length,
    proposedFineTotal: selectedViolations.reduce(
      (sum, v) => sum + (v.proposedFine ?? 0),
      0,
    ),
    mandatoryPending:
      selectedDays.filter((d) => d.qualityPending).length +
      selectedDays.filter((d) => !d.uniform || d.uniform.status === "pending")
        .length,
    meetingPending: selectedViolations.filter(
      (v) => v.meetingRequired && !v.meeting,
    ).length,
    unconfiguredFines: selectedViolations.filter(
      (v) => v.fineStatus === "configuration_required",
    ).length,
  };
  const base = (d: Day) => ({
    employeeId: d.employee_id,
    date: d.work_date,
    revision,
  });
  const [touched, setTouched] = useState(new Set<string>());
  const dayKey = (d: Day) => `${d.employee_id}:${d.work_date}`;
  const uniformText = (d: Day) =>
    d.uniform?.declared_at
      ? d.uniform.declared_has_uniform
        ? t("haveUniform")
        : t("noUniform")
      : d.uniform?.admin_has_uniform != null
        ? `Recorded by administrator: ${d.uniform.admin_has_uniform ? "Wearing uniform" : "No uniform"}`
        : t("noUniformDeclaration");
  const dayCard = (d: Day, pendingOnly: boolean) => {
    const quality = pendingOnly ? d.qualityPending : !!d.quality,
      uniform = pendingOnly ? !d.uniform || d.uniform.status === "pending" : !!d.uniform && d.uniform.status !== "pending";
    if (!quality && !uniform && !pendingOnly) return null;
    return (
      <article className="request-card" key={`${d.employee_id}:${d.work_date}`}>
        <div className="request-heading">
          <strong>Workday</strong>
          <span className="badge">{d.work_date}</span>
        </div>
        {d.open_sessions > 0 && (
          <p className="notice">Work is in progress. Quality review becomes available after attendance closes.</p>
        )}
        {locked(d.work_date) && <p className="notice">{t("reviewLocked")}</p>}
        <div className="review-day-times">
          <p><strong>Scheduled:</strong> {d.shifts.filter((s) => s.status === "scheduled").map((s) => `${clock(s.start_at).slice(0, 5)}–${clock(s.end_at).slice(0, 5)}`).join(" / ") || "No regular shift"}</p>
          <p><strong>Recorded:</strong> {d.sessions.map((s) => `${clock(s.check_in).slice(0, 5)}–${s.check_out === null ? "In progress" : clock(s.check_out).slice(0, 5)}`).join(" / ")}</p>
          <p>Recorded duration: {hours(d.actualSeconds)} · Credited: {hours(d.regularSeconds + d.overtimeSeconds)} · Paid hours: {hours(d.paidSeconds)}</p>
        </div>
        <ShiftAttendanceDetails rows={d.shiftAttendance} />
        {pendingOnly ? (
          <>
            {d.qualityPending && d.quality && <p>{t("qualityStale")}</p>}
            {d.qualityPending && d.inProgress && <p className="notice">Review quality after the last shift ends and all attendance is closed.</p>}
            {(!d.uniform || d.uniform.status === "pending") && <p>{t("uniformToday")}: {uniformText(d)}</p>}
            {admin && !locked(d.work_date) && (
              <DayReview d={d} revision={revision} onSaved={reload}
                onTouched={() => setTouched((v) => new Set(v).add(dayKey(d)))} />
            )}
          </>
        ) : (
          <>
        {quality && (
          <details
            className="review-section"
            open={pendingOnly && d.qualityPending && !d.inProgress}
          >
            <summary>
              {t("qualityRating")} ·{" "}
              {d.qualityPending ? t("pending") : d.quality?.rating}
              {!pendingOnly && !locked(d.work_date) ? " · Change review" : ""}
            </summary>
            {d.qualityPending && (
              <p>{d.quality ? t("qualityStale") : t("qualityPending")}</p>
            )}
            {d.quality && <p>{d.quality.comment}</p>}
            {d.inProgress && <p className="notice">Review quality after the last shift ends and all attendance is closed.</p>}
            {admin && !locked(d.work_date) && !d.inProgress && (
              <Form
                version={JSON.stringify([d.attendance_snapshot, d.quality])}
                path="/discipline/quality"
                build={(f) => ({
                  ...base(d),
                  rating: get(f, "rating"),
                  comment: get(f, "comment"),
                  reason: get(f, "reason"),
                })}
                onSaved={reload}
                submitLabel="confirmReview"
              >
                <label>
                  {t("qualityRating")}
                  <select
                    name="rating"
                    defaultValue={d.quality?.rating ?? "good"}
                  >
                    <option value="excellent">{t("excellent")}</option>
                    <option value="good">{t("good")}</option>
                    <option value="bad">{t("bad")}</option>
                  </select>
                </label>
                <Field
                  label="reviewComment"
                  name="comment"
                  required={false}
                  value={d.quality?.comment ?? ""}
                />
                <Reason required />
              </Form>
            )}
          </details>
        )}
        {uniform && (
          <details
            className="review-section"
            open={pendingOnly && (!d.uniform || d.uniform.status === "pending")}
          >
            <summary>
              {t("uniformToday")} · {d.uniform?.status ?? t("pending")}
              {!pendingOnly && !locked(d.work_date) ? " · Change review" : ""}
            </summary>
            <p>{uniformText(d)}</p>
            <p>{d.uniform?.decision_reason}</p>
            {admin && !locked(d.work_date) && (
              <Form
                version={JSON.stringify(d.uniform)}
                path="/discipline/uniform/decision"
                build={(f) => ({
                  ...base(d),
                  status: get(f, "status"),
                  ...(!d.uniform?.declared_at && get(f, "status") !== "pending"
                    ? { hasUniform: get(f, "status") === "approved" }
                    : {}),
                  reason: get(f, "reason"),
                })}
                onSaved={reload}
                submitLabel="confirmReview"
              >
                <label>
                  {t("decision")}
                  <select
                    name="status"
                    required
                    defaultValue={uniformDefault(d)}
                  >
                    {d.uniform?.status !== "pending" && d.uniform && <option value="pending">{t("resetUniform")}</option>}
                    {canApproveUniform(d) && (
                        <option value="approved">Approve / wearing uniform</option>
                      )}
                    <option value="rejected">{t("missingUniform")}</option>
                  </select>
                </label>
                <Reason required />
              </Form>
            )}
          </details>
        )}
          </>
        )}
      </article>
    );
  };
  const violationCard = (v: Violation, history = false) => (
    <article className="request-card" key={v.id}>
      <div className="request-heading">
        <strong>{name(v.employee_id)}</strong>
        <span className={`badge discipline-${v.status}`}>
          {v.category} · {v.status}
        </span>
      </div>
      <p>
        {v.work_date} · {v.reason}
      </p>
      <p>{v.ordinal ? `#${v.ordinal} · ${v.action}` : v.action}</p>
      <p>
        {t("proposedFines")}:{" "}
        <strong>
          {v.proposedFine === null
            ? t("fineUnconfigured")
            : formatMoney(v.proposedFine)}
        </strong>
      </p>
      {v.decision && (
        <p>
          {t("decisionReason")}: {v.decision.reason}
        </p>
      )}
      {v.meeting && (
        <p className="success">
          {t("meetingCompleted")} · {v.meeting.reason}
        </p>
      )}
      {admin &&
        v.ordinal > 0 &&
        (v.proposedFine ?? 0) > 0 &&
        !history && (
          v.fineDecision ? <div className="fine-history">
            <p>Fine {v.fineDecision.status} · {formatMoney(v.fineDecision.amount)}{v.fineDecision.reason ? ` · ${v.fineDecision.reason}` : ""}</p>
            {canApprove && !locked(v.work_date) && <FineDecision fine={v} revision={revision} periodDate={periodDate} onSaved={reload} />}
          </div> : canApprove && !locked(v.work_date)
            ? <FineDecision fine={v} revision={revision} periodDate={periodDate} onSaved={reload} />
            : <p className="muted">A payroll approver must decide this fine.</p>
        )}
      {admin && !locked(v.work_date) && (
        <details className="review-section">
          <summary>{t("violationDecision")}</summary>
          <Form
            version={JSON.stringify([v.source_token, v.decision])}
            path="/discipline/violation/decision"
            build={(f) => ({
              id: v.id,
              revision,
              status: get(f, "status"),
              reason: get(f, "reason"),
            })}
            onSaved={reload}
            submitLabel="confirmReview"
          >
            <label>
              {t("decision")}
              <select name="status" required defaultValue={v.decision?.status ?? ""}>
                <option value="" disabled>Choose a decision</option>
                <option value="confirmed">{t("confirmedViolation")}</option>
                <option value="excused">{t("excuseViolation")}</option>
                <option value="reversed">{t("reverseViolation")}</option>
              </select>
            </label>
            <Reason />
          </Form>
        </details>
      )}
      {admin && v.status !== "detected" && v.meetingRequired && !v.meeting && !locked(v.work_date) && (
        <Form
          version={v.progressionToken}
          path="/discipline/meeting"
          build={(f) => ({
            id: v.id,
            date: v.work_date,
            revision,
            reason: get(f, "reason"),
          })}
          onSaved={reload}
          submitLabel="meetingComplete"
        >
          <Reason />
        </Form>
      )}
    </article>
  );
  const earlyCard = (e: Data["early"][number]) => (
    <article className="request-card" key={e.shiftId}>
      <strong>
        {name(e.employee_id)} · {e.work_date}
      </strong>
      <p>
        {t("earlyReview")}: {hours(e.missedSeconds)}
      </p>
      <p>{t("earlyHelp")}</p>
      {!locked(e.work_date) && (
        <Form
          version={JSON.stringify([e.sourceToken, e.review])}
          path="/discipline/early/decision"
          build={(f) => ({
            shiftId: e.shiftId,
            date: e.work_date,
            revision,
            status: get(f, "status"),
            reason: get(f, "reason"),
          })}
          onSaved={reload}
          submitLabel="confirmReview"
        >
          <label>
            {t("decision")}
            <select name="status">
              <option value="approved">{t("approve")}</option>
              <option value="rejected">{t("reject")}</option>
            </select>
          </label>
          <Reason />
        </Form>
      )}
    </article>
  );
  const grouped = new Map<string, { employeeId: string; date: string; tasks: ReviewTask[] }>();
  for (const task of selectedTasks) {
    const key = `${task.employeeId}:${task.date}`;
    const group = grouped.get(key) ?? { employeeId: task.employeeId, date: task.date, tasks: [] };
    group.tasks.push(task);
    grouped.set(key, group);
  }
  // Days that need nothing beyond routine quality/uniform decisions, still on their defaults.
  const bulkDays = [...grouped.values()].flatMap((group) => {
    const d = selectedDays.find((x) => x.employee_id === group.employeeId && x.work_date === group.date);
    if (!d || locked(d.work_date) || touched.has(dayKey(d))) return [];
    if (!group.tasks.every((task) => ["quality_review", "uniform_review"].includes(task.kind))) return [];
    const quality = d.qualityPending && !d.inProgress,
      uniform = !d.uniform || d.uniform.status === "pending";
    if (uniform && !canApproveUniform(d)) return [];
    if (!quality && !uniform) return [];
    return [{
      employeeId: d.employee_id,
      date: d.work_date,
      ...(quality ? { quality: { rating: "good" } } : {}),
      ...(uniform ? { uniform: { status: "approved", ...(!d.uniform?.declared_at ? { hasUniform: true } : {}) } } : {}),
    }];
  });
  function pendingDay(group: { employeeId: string; date: string; tasks: ReviewTask[] }) {
    const day = selectedDays.find((d) => d.employee_id === group.employeeId && d.work_date === group.date);
    return <article className="review-day" data-review-date={group.date}>
      <header className="request-heading"><h3>{group.date}</h3><span className="badge status-attention">Pending {group.tasks.length}</span></header>
      {[...new Set(group.tasks.map((task) => task.blockedBy).filter(Boolean))].map((message) => <p className="notice" key={message}>{message}</p>)}
      {day && dayCard(day, true)}
      {selectedViolations.filter((v) => group.tasks.some((task) => task.subjectId === v.id)).map((v) => <div key={v.id}>
        {violationCard(v)}
        {group.tasks.some((task) => task.subjectId === v.id && task.kind === "fine_configuration") && <p className="notice">A super administrator must configure the fine policy. Disciplinary decisions remain separate.</p>}
      </div>)}
      {data!.early.filter((e) => group.tasks.some((task) => task.kind === "early_departure" && task.subjectId === e.shiftId)).map((e) => earlyCard(e))}
      {group.tasks.filter((task) => ["pending_request", "open_attendance"].includes(task.kind)).map((task) => <article className="request-card" key={task.id}>
        <strong>{task.kind === "pending_request" ? "Attendance request" : "Checkout needs review"}</strong>
        <p>{task.message}</p>
        <button type="button" className="secondary compact" onClick={() => navigateTo(task.kind === "pending_request" ? "requests" : "attendance", task.employeeId, task.date, task.kind)}>Review</button>
      </article>)}
    </article>;
  }
  return (
    <div className="attendance-stack review-inbox">
      <div className="filter-bar">
        <MonthPicker value={periodDate} onChange={setPeriodDate} label="Review month" />
        {admin && data && <label>{t("reviewEmployeeFilter")}
          <select aria-label={t("reviewEmployeeFilter")} value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
            <option value="">{t("all")}</option>
            {data.people.filter((p) => showDisabled || !!p.active).map((p) => <option value={p.id} key={p.id}>{p.full_name}</option>)}
          </select>
        </label>}
        {admin && <MoreOptions active={showDisabled}>
          <EmployeeVisibility showDisabled={showDisabled} onChange={(show) => {
            setShowDisabled(show);
            if (!show && !data?.people.find((p) => p.id === employeeFilter)?.active) setEmployeeFilter("");
          }} disabledCount={data?.people.filter((p) => !p.active).length ?? 0} />
        </MoreOptions>}
        <button type="button" className="secondary compact" disabled={loading} onClick={() => void reload()}>{t("refresh")}</button>
      </div>
      <ErrorNotice error={error} />
      {!data && <p>{loading ? t("loading") : t("retry")}</p>}
      {data && <>
        <p>{data.period.from} – {data.period.to}. Reviews are grouped by employee and workday.</p>
        <div className="attendance-metrics">
          {[["Pending decisions", selectedTasks.length], [t("violationCount"), summary.countedViolations], [t("proposedFines"), formatMoney(summary.proposedFineTotal)]].map(([label, value]) => <section className="panel attendance-panel" key={label}><small>{label}</small><strong>{value}</strong></section>)}
        </div>
        {admin && <div className="discipline-tabs" role="group" aria-label="Review inbox view">
          <button type="button" className={tab === "queue" ? "primary" : "secondary"} onClick={() => setTab("queue")}>Pending ({selectedTasks.length})</button>
          <button type="button" className={tab === "history" ? "primary" : "secondary"} onClick={() => setTab("history")}>History</button>
        </div>}
        {admin && tab === "queue" && <section className="review-employee-section">
          <BulkApprove days={bulkDays} revision={revision} onDone={reload} />
          <EmployeeCards name={name} collapsible expanded={!!employeeFilter}
            summary={(id) => <p>Pending {selectedTasks.filter((task) => task.employeeId === id).length} decisions</p>}
            rows={[...grouped.values()].map((group) => ({ employeeId: group.employeeId, key: group.date, content: pendingDay(group) }))} />
          {!selectedTasks.length && <p>{t("noPendingReviews")}</p>}
        </section>}
        {(!admin || tab === "history") && <section className="review-employee-section">
          <h2>Completed reviews and decision history</h2>
          {!!data.fineDecisions.filter(visible).length && <details className="panel attendance-panel">
            <summary>Fine decision history ({data.fineDecisions.filter(visible).length})</summary>
            {data.fineDecisions.filter(visible).map((f) => {
              const current = selectedViolations.find((v) => v.id === f.violation_id && v.progressionToken === f.progression_token && v.fineDecision);
              return <article className="request-card" key={f.violation_id}>
                <strong>{name(f.employee_id)} · {f.work_date} · {f.status} · {formatMoney(f.amount)}</strong>
                {f.reason && <p>{f.reason}</p>}<DecisionStamp decision={f} />
                {!current && <p className="muted">Superseded by changed attendance, discipline or policy. This decision is not applied.</p>}
                {admin && canApprove && current && current.ordinal > 0 && !locked(f.work_date) && <FineDecision fine={current} revision={revision} periodDate={periodDate} onSaved={reload} />}
              </article>;
            })}
          </details>}
          <EmployeeCards name={name} rows={[
            ...selectedDays.filter((d) => d.quality || (d.uniform && d.uniform.status !== "pending")).map((d) => ({ employeeId: d.employee_id, key: `day:${d.work_date}`, content: dayCard(d, false) })),
            ...data.early.filter(visible).filter((e) => e.review).map((e) => ({ employeeId: e.employee_id, key: `early:${e.shiftId}`, content: <article className="request-card"><strong>{e.work_date} · Early departure</strong><p>{e.review!.status} · {e.review!.reason}</p>{admin && !locked(e.work_date) && <details><summary>Change decision</summary>{earlyCard(e)}</details>}</article> })),
          ]} />
          <details className="panel attendance-panel">
            <summary>Monthly discipline record ({selectedViolations.length})</summary>
            <p>{t("fineHelp")}</p>
            {selectedViolations.map((v) => violationCard(v, true))}
            {!selectedViolations.length && <p>No violations in this period.</p>}
          </details>
          {!!data.history.filter(visible).length && <details className="panel attendance-panel">
            <summary>{t("disciplineHistory")}</summary><p>{t("disciplineHistoryHelp")}</p>
            {data.history.filter(visible).map((h) => <article className="request-card" key={h.violation_id + h.source_token}><strong>{name(h.employee_id)} · {h.work_date}</strong><p>{h.category} · {h.reason}</p></article>)}
          </details>}
        </section>}
        {superAdmin && <details id="discipline-policy" className="panel attendance-panel request-composer">
          <summary>{t("disciplinePolicy")}</summary><p>{t("policyHelp")}</p>
          <PolicyForm key={`${data.policyId}:${data.period.from}`} data={data} onSaved={reload} />
        </details>}
      </>}
    </div>
  );
}

type BulkDay = { employeeId: string; date: string; quality?: { rating: string }; uniform?: { status: string; hasUniform?: boolean } };
// Saves routine days in batches of five (the API limit), carrying the returned revision forward.
function BulkApprove({ days, revision, onDone }: { days: BulkDay[]; revision: number; onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [error, setError] = useState("");
  if (!days.length && progress === null && !error) return null;
  async function run() {
    setConfirming(false);
    setError("");
    let current = revision, saved = 0;
    setProgress(0);
    try {
      for (let i = 0; i < days.length; i += 5) {
        const batch = days.slice(i, i + 5);
        const result = await api<{ revision: number }>("/discipline/days", "POST",
          { revision: current, reason: "", days: batch }, crypto.randomUUID());
        current = result.revision;
        saved += batch.length;
        setProgress(saved);
      }
    } catch (e) {
      setError(`${saved} of ${days.length} days saved. ${(e as Error).message}`);
    } finally {
      setProgress(null);
      await onDone();
    }
  }
  return <div className="panel attendance-panel bulk-approve">
    <ErrorNotice error={error} />
    {progress !== null ? <p role="status">Saving {progress} of {days.length} days…</p>
      : confirming ? <>
        <p>Confirm {days.length} {days.length === 1 ? "day" : "days"} as Good quality with uniform approved? Days with lateness, early departures, requests, a missing uniform or a choice you changed are left for you to review.</p>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={() => setConfirming(false)}>{t("cancel")}</button>
          <button type="button" className="primary" onClick={() => void run()}>Confirm all ({days.length})</button>
        </div>
      </> : !!days.length && <>
        <p>{days.length} routine {days.length === 1 ? "day needs" : "days need"} only quality and uniform confirmation.</p>
        <button type="button" className="primary" onClick={() => setConfirming(true)}>Approve all as shown ({days.length})</button>
      </>}
  </div>;
}

function PolicyForm({
  data,
  onSaved,
}: {
  data: Data;
  onSaved: () => Promise<void>;
}) {
  const fine = (f: FormData, key: string) =>
    get(f, key).trim() === "" ? null : Number(get(f, key));
  return (
    <Form
      path="/discipline/policy"
      build={(f) => ({
        revision: data.revision,
        effectiveDate: get(f, "effectiveDate"),
        secondFine: fine(f, "secondFine"),
        thirdFine: fine(f, "thirdFine"),
        fourthFine: fine(f, "fourthFine"),
        laterFine: fine(f, "laterFine"),
        laterAction: get(f, "laterAction"),
        reason: get(f, "reason"),
      })}
      onSaved={onSaved}
    >
      <Field
        label="policyEffective"
        name="effectiveDate"
        type="date"
        value={data.period.from}
      />
      {(["secondFine", "thirdFine", "fourthFine", "laterFine"] as const).map(
        (key) => (
          <Field
            key={key}
            label={key}
            name={key}
            type="number"
            required={false}
            value={data.policy[key] === null ? "" : String(data.policy[key])}
          />
        ),
      )}
      <Field
        label="laterAction"
        name="laterAction"
        value={data.policy.laterAction}
      />
      <Reason />
    </Form>
  );
}
