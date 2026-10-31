import { formatMoney } from "../shared/domain";

type Event = {
  action: string;
  before_json: string | null;
  after_json: string | null;
  entity_name?: string | null;
};
function read(value: string | null): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(value ?? "null");
    return result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
const time = (value: unknown) =>
  typeof value === "number"
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tashkent",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value * 1000)
    : "not recorded";
// Dates inside sentences use the app-wide "31 Oct 2026" format.
const day = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(Date.parse(value + "T00:00:00Z"))
    : String(value);
export function auditSummary(event: Event) {
  const before = read(event.before_json),
    after = read(event.after_json);
  const subject = event.entity_name ? ` for ${event.entity_name}` : "";
  if (event.action === "attendance.manual.add")
    return `Manual attendance added for ${after.employeeName ?? "an employee"}: ${time(after.checkIn)} to ${time(after.checkOut)}.`;
  if (event.action === "telegram.message.send")
    return `Telegram message queued for ${after.recipientName ?? "a user"}.`;
  if (event.action === "role.daily-pay")
    return after.enabled
      ? `Daily extended-hours rate${subject} set to ${formatMoney(Number(after.hourlyRate))} per hour after ${Number(after.thresholdMinutes) / 60} salary-counted hours, from ${day(after.effectiveDate)}.`
      : `Daily extended-hours rate${subject} disabled from ${day(after.effectiveDate)}.`;
  if (event.action === "rate.create") {
    const old = before.hourly_rate ?? before.hourlyRate;
    const next = after.hourlyRate;
    return typeof next === "number"
      ? `Hourly rate${subject} ${typeof old === "number" ? `changed from ${formatMoney(old)} to` : "set to"} ${formatMoney(next)}${after.effectiveDate ? ` from ${day(after.effectiveDate)}` : ""}.`
      : `Hourly rate updated${subject}.`;
  }
  if (event.action === "schedule.shift.edit")
    return `Daily schedule${subject} changed from ${time(before.start_at)} to ${time(before.end_at)} (${before.status}) → ${time(after.start_at)} to ${time(after.end_at)} (${after.status}).`;
  if (event.action === "employee.update") {
    const changes = [];
    if (after.fullName !== undefined && after.fullName !== before.full_name)
      changes.push(
        `name changed from ${before.full_name} to ${after.fullName}`,
      );
    if (
      typeof after.active === "boolean" &&
      after.active !== Boolean(before.active)
    )
      changes.push(after.active ? "account reactivated" : "account disabled");
    if (after.levelId !== undefined)
      changes.push(
        `role level changed${after.effectiveDate ? ` from ${day(after.effectiveDate)}` : ""}`,
      );
    return `Employee${subject}: ${changes.join("; ") || "details updated"}.`;
  }
  if (
    event.action === "uniform.correct" ||
    event.action === "uniform.declare"
  ) {
    const choice = after.hasUniform ? "wearing uniform" : "no uniform";
    if (
      event.action === "uniform.correct" &&
      before.declared_has_uniform !== undefined
    )
      return `Uniform choice${subject} corrected from ${before.declared_has_uniform ? "wearing uniform" : "no uniform"} to ${choice}.`;
    return `Uniform choice${subject} ${event.action === "uniform.correct" ? "corrected" : "recorded"}: ${choice}.`;
  }
  if (event.action === "uniform.review")
    return `Uniform review${subject}: ${after.status}.`;
  if (event.action === "quality.review")
    return `Work quality${subject} reviewed as ${after.rating}.`;
  if (event.action === "attendance.check_in")
    return `Checked in${subject} at ${time(after.checkIn)}.`;
  if (event.action === "attendance.check_out")
    return `Checked out${subject} at ${time(after.checkout)}.`;
  if (event.action === "attendance.checkout.correct")
    return `Checkout${subject} corrected from ${time(before.check_out)} to ${time(after.checkout)}. Original attendance preserved.`;
  if (
    event.action === "attendance.close" ||
    event.action === "attendance.admin_close"
  )
    return `Administrator confirmed departure${subject} at ${time(after.checkout)}.`;
  if (event.action.startsWith("request.")) {
    const [, kind, decision] = event.action.split(".");
    return `${kind.charAt(0).toUpperCase() + kind.slice(1)} request${subject} ${decision === "create" ? "submitted" : decision}${after.date ? ` for ${day(after.date)}` : ""}.`;
  }
  const labels: Record<string, string> = {
    "payroll.finalize": "Monthly salary calculation finalized",
    "payroll.reopen": "Monthly salary calculation reopened",
    "payroll.adjustment.propose": "Salary adjustment proposed",
    "payroll.adjustment.decision": "Salary adjustment reviewed",
    "payroll.fine.decision": "Salary fine reviewed",
    "tablet.register": "Reception display registered",
    "tablet.revoke": "Reception display revoked",
    "schedule.weekly.edit": "Recurring weekly schedule changed",
    "schedule.weekly": "Recurring weekly schedule added",
    "employee.create": "Employee registered",
    "employee.telegram.change": "Employee Telegram account changed",
    "admin.access.change": "Administrator permissions changed",
    "employee.delete": "Employee permanently deleted",
    "bootstrap": "Owner account created",
    "role.create": "Role created",
    "roles.update": "Role updated",
    "level.create": "Level created",
    "levels.update": "Level updated",
    "schedule.weekly.create": "Recurring weekly schedule added",
    "schedule.override": "One-day schedule change saved",
    "schedule.extra.create": "Extra shift added",
    "overtime.approve": "Overtime approved",
    "coverage.create": "Shift coverage requested",
    "coverage.accepted": "Shift coverage accepted",
    "coverage.declined": "Shift coverage declined",
    "absence.policy": "Absence pay policy changed",
    "discipline.policy": "Disciplinary fine policy changed",
    "violation.decision": "Violation decision recorded",
    "early.review": "Early departure reviewed",
    "meeting.complete": "Manager meeting recorded",
    "payroll.settings": "Payroll month settings changed",
    "debtors.record": "Debtor figures saved",
    "notifications.preferences": "Notification preferences changed",
  };
  // Unknown actions still read as a sentence: "foo.bar_baz" → "Foo bar baz".
  const fallback = event.action.replace(/[._-]+/g, " ");
  return (
    (labels[event.action] ??
      fallback.charAt(0).toUpperCase() + fallback.slice(1)) +
    subject +
    "."
  );
}
