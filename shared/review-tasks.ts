import type { CheckoutState } from "./checkout";

export type ReviewTask = {
  id: string;
  employeeId: string;
  date: string;
  kind: string;
  message: string;
  subjectId: string;
  sourceVersion: string;
  state: "pending" | "blocked";
  blockedBy?: string;
  requiredPermission: "attendance.manage" | "salary.manage" | "payroll.approve" | "super_admin" | "debtors";
};
export function reviewTaskPermission(kind: string): ReviewTask["requiredPermission"] {
  if (kind === "fine_configuration") return "super_admin";
  if (kind === "missing_rate") return "salary.manage";
  if (kind === "missing_debt_entry") return "debtors";
  if (["quality_review", "uniform_review", "lateness_review", "early_departure", "manager_meeting", "pending_request", "invalid_session", "open_attendance"].includes(kind)) return "attendance.manage";
  return "payroll.approve";
}
export function reviewTask(employeeId: string, date: string, kind: string, message: string,
  subjectId = date, sourceVersion = "", blockedBy?: string): ReviewTask {
  return { id: `${employeeId}:${date}:${kind}:${subjectId}`, employeeId, date, kind, message,
    subjectId, sourceVersion, state: blockedBy ? "blocked" : "pending", ...(blockedBy ? { blockedBy } : {}),
    requiredPermission: reviewTaskPermission(kind) };
}

type Day = { employee_id: string; work_date: string; qualityPending: boolean; attendance_snapshot: string;
  inProgress: boolean; open_sessions: number; uniform: { status: string } | null };
type Violation = { id: string; employee_id: string; work_date: string; status: string; ordinal: number;
  proposedFine: number | null; fineReviewed: boolean; progressionToken: string; meetingRequired: boolean; meeting: unknown };
type Early = { shiftId: string; employee_id: string; work_date: string; sourceToken: string; review: unknown };
type Request = { id: string; employee_id: string; work_date: string };
type Checkout = { id: string; employee_id: string; work_date: string; state: CheckoutState; expectedEnd: number };

// The daily inbox, overview and monthly payroll consume these same unresolved
// tasks. Financial approvals and discipline remain separate audited decisions.
export function disciplineReviewTasks(input: { days: Day[]; violations: Violation[]; early: Early[];
  requests: Request[]; checkouts: Checkout[]; period: { from: string; to: string };
  locks: { from_date: string; to_date: string }[] }) {
  const tasks: ReviewTask[] = [];
  for (const d of input.days) {
    if (d.qualityPending) tasks.push(reviewTask(d.employee_id, d.work_date, "quality_review",
      "Confirm work quality for this completed workday.", d.work_date, d.attendance_snapshot,
      d.inProgress ? d.open_sessions ? "Work is in progress. Close attendance before reviewing quality."
        : "Quality review is available after the last scheduled shift ends." : undefined));
    if (!d.uniform || d.uniform.status === "pending") tasks.push(reviewTask(d.employee_id, d.work_date,
      "uniform_review", "Review the uniform choice or record your observation.", d.work_date, JSON.stringify(d.uniform)));
  }
  for (const v of input.violations) {
    const prerequisite = v.status === "detected" ? "Confirm or excuse lateness first." : undefined;
    if (v.status === "detected") tasks.push(reviewTask(v.employee_id, v.work_date, "lateness_review",
      "Confirm or excuse the detected lateness.", v.id, v.progressionToken));
    if (v.ordinal > 0 && v.proposedFine === null) tasks.push(reviewTask(v.employee_id, v.work_date,
      "fine_configuration", "A super administrator must configure the fine policy. Excuse or reverse the violation only if the evidence warrants it.", v.id, v.progressionToken, prerequisite));
    if (v.ordinal > 0 && (v.proposedFine ?? 0) > 0 && !v.fineReviewed) tasks.push(reviewTask(v.employee_id,
      v.work_date, "fine_approval", "Approve an amount or reject this fine with zero.", v.id, v.progressionToken, prerequisite));
    if (v.meetingRequired && !v.meeting) tasks.push(reviewTask(v.employee_id, v.work_date,
      "manager_meeting", "Record the required manager meeting.", v.id, v.progressionToken, prerequisite));
  }
  for (const e of input.early) if (!e.review) tasks.push(reviewTask(e.employee_id, e.work_date,
    "early_departure", "Review permission for this early departure.", e.shiftId, e.sourceToken));
  for (const r of input.requests) tasks.push(reviewTask(r.employee_id, r.work_date,
    "pending_request", "Resolve the pending attendance request.", r.id));
  for (const s of input.checkouts) if (s.state === "review") tasks.push(reviewTask(s.employee_id, s.work_date,
    "open_attendance", "Checkout is unresolved after the grace period. Confirm the actual departure time.", s.id, String(s.expectedEnd)));
  return tasks.filter((t) => t.date >= input.period.from && t.date <= input.period.to &&
    !input.locks.some((l) => t.date >= l.from_date && t.date <= l.to_date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
