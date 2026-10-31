import { checkoutTiming } from "../shared/checkout";
import type { Session, Shift } from "../shared/attendance";

type OpenSession = Session & { id: string; employee_id: string; work_date: string };
type EmployeeShift = Shift & { employee_id: string };
type Approval = {
  employee_id: string;
  work_date: string;
  start_at: number;
  end_at: number;
};

// Load context independently of the selected dashboard date or payroll month.
export async function openCheckoutTimings(db: D1Database, time: number) {
  const [sessions, shifts, approvals] = await db.batch([
    db.prepare("SELECT * FROM attendance_sessions WHERE check_out IS NULL"),
    db.prepare("SELECT DISTINCT s.* FROM scheduled_shifts s JOIN attendance_sessions a ON a.employee_id=s.employee_id AND a.work_date=s.work_date WHERE a.check_out IS NULL"),
    db.prepare("SELECT DISTINCT o.* FROM overtime_approvals o JOIN attendance_sessions a ON a.employee_id=o.employee_id AND a.work_date=o.work_date WHERE a.check_out IS NULL"),
  ]);
  return (sessions.results as unknown as OpenSession[]).map((session) => ({
    session,
    ...checkoutTiming(
      session,
      (shifts.results as unknown as EmployeeShift[]).filter((s) =>
        s.employee_id === session.employee_id && s.work_date === session.work_date),
      (approvals.results as Approval[])
        .filter((o) => o.employee_id === session.employee_id && o.work_date === session.work_date)
        .map((o) => ({ start: o.start_at, end: o.end_at })),
      time,
    )!,
  }));
}
