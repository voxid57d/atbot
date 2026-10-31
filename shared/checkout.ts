import type { Interval, Session, Shift } from "./attendance";

export type CheckoutState = "working" | "reminder" | "overdue" | "review";
export type CheckoutTiming = { expectedEnd: number; state: CheckoutState };

export function checkoutState(expectedEnd: number, time: number): CheckoutState {
  if (time >= expectedEnd + 3600) return "review";
  if (time >= expectedEnd + 1800) return "overdue";
  return time >= expectedEnd ? "reminder" : "working";
}

// Use absolute timestamps: crossing midnight is never itself a missed checkout.
export function checkoutTiming(
  session: Session,
  shifts: Shift[],
  approvals: Interval[] = [],
  time = Math.floor(Date.now() / 1000),
): CheckoutTiming | null {
  if (session.check_out !== null) return null;
  const scheduled = shifts.filter((s) => s.status === "scheduled");
  const shift =
    scheduled.find((s) => s.id === session.shift_id) ??
    (!session.shift_id
      ? scheduled.find((s) =>
          s.start_at <= session.check_in && s.end_at > session.check_in &&
          (s.kind === "regular" || !!s.overtime_approved))
      : undefined);
  let expectedEnd = shift
    ? Math.max(shift.end_at, session.check_in)
    : session.check_in + 18 * 3600;
  // One open visit is supported across the day's split regular shifts. The gap
  // remains unpaid; checkout reminders follow the last regular window.
  if (shift?.kind === "regular")
    expectedEnd = Math.max(expectedEnd, ...scheduled.filter((s) =>
      s.kind === "regular" && s.work_date === shift.work_date && s.start_at >= shift.start_at)
      .map((s) => s.end_at));
  const extensions = [
    ...approvals,
    ...scheduled
      .filter((s) => s.kind === "extra" && s.overtime_approved)
      .map((s) => ({ start: s.start_at, end: s.end_at })),
  ].sort((a, b) => a.start - b.start);
  // Extra time must still connect to the regular visit; a separate extra shift does not extend it.
  for (const interval of extensions)
    if (interval.start <= expectedEnd && interval.end > expectedEnd)
      expectedEnd = interval.end;
  return { expectedEnd, state: checkoutState(expectedEnd, time) };
}
