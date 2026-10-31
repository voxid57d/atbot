import { reviewTaskPermission, type ReviewTask } from "../shared/review-tasks";
export type SalaryWarning = Partial<ReviewTask> & {
  employeeId: string;
  date: string;
  kind: string;
  message: string;
};
export type ReviewPermissions = {
  attendance: boolean;
  rates: boolean;
  approve: boolean;
  superAdmin?: boolean;
};
export function salaryTaskLabel(kind: string) {
  const labels: Record<string, string> = {
    quality_review: "Review work quality",
    uniform_review: "Review uniform choice",
    lateness_review: "Review late arrival",
    early_departure: "Review early departure",
    manager_meeting: "Record manager meeting",
    fine_configuration: "Review fine policy",
    fine_approval: "Approve or reject proposed fine",
    pending_request: "Review attendance request",
    invalid_session: "Correct attendance times",
    open_attendance: "Review unresolved checkout",
    missing_rate: "Set the hourly rate",
    missing_debt_entry: "Enter shared debtor counts",
    paid_leave: "Add approved leave pay",
    pending_adjustment: "Review salary adjustment",
    negative_pay: "Check salary deductions",
    unworked_day: "Review day with no attendance",
    unapproved_overtime: "Review extra worked time",
  };
  return labels[kind] ?? "Review salary issue";
}
export function salaryTaskPage(kind: string) {
  if (kind === "missing_debt_entry") return "debtors";
  if (
    [
      "quality_review",
      "uniform_review",
      "lateness_review",
      "early_departure",
      "manager_meeting",
      "fine_configuration",
    ].includes(kind)
  )
    return "reviews";
  if (kind === "pending_request") return "requests";
  if (kind === "missing_rate") return "roles";
  if (["open_attendance", "invalid_session"].includes(kind))
    return "attendance";
  return "payroll";
}
export function canReviewTask(task: string | SalaryWarning, permissions: ReviewPermissions) {
  const kind = typeof task === "string" ? task : task.kind;
  if (typeof task !== "string" && task.state === "blocked") return false;
  if (["paid_leave", "negative_pay"].includes(kind))
    return permissions.rates || permissions.approve;
  const required = typeof task === "string" ? reviewTaskPermission(kind) : task.requiredPermission ?? reviewTaskPermission(kind);
  if (required === "super_admin") return !!permissions.superAdmin;
  if (required === "attendance.manage") return permissions.attendance;
  if (required === "salary.manage") return permissions.rates;
  if (required === "debtors") return true;
  return permissions.approve;
}
const taskOrder = [
  "open_attendance",
  "invalid_session",
  "pending_request",
  "missing_rate",
  "quality_review",
  "uniform_review",
  "lateness_review",
  "early_departure",
  "manager_meeting",
  "fine_configuration",
  "fine_approval",
  "paid_leave",
  "pending_adjustment",
  "negative_pay",
  "unworked_day",
  "unapproved_overtime",
];
export const orderedSalaryTasks = (warnings: SalaryWarning[]) =>
  [...warnings].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (taskOrder.indexOf(a.kind) < 0
        ? taskOrder.length
        : taskOrder.indexOf(a.kind)) -
        (taskOrder.indexOf(b.kind) < 0
          ? taskOrder.length
          : taskOrder.indexOf(b.kind)),
  );
export function finalizationBlockers(
  to: string,
  today: string,
  count: number,
  employees: number,
  openSessions = 0,
) {
  const reasons: string[] = [];
  if (to >= today)
    reasons.push(
      to.slice(0, 7) + "-01" > today
        ? "This month has not started yet."
        : "This month is still ongoing.",
    );
  if (count)
    reasons.push(
      `${count} review ${count === 1 ? "task remains" : "tasks remain"}.`,
    );
  if (openSessions)
    reasons.push("Attendance is still in progress. Close all sessions in this period before finalizing.");
  if (!employees)
    reasons.push("There are no employee salary records for this month.");
  return reasons;
}
