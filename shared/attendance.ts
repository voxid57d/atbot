export type Interval = { start: number; end: number };
export type Session = {
  id?: string;
  check_in: number;
  check_out: number | null;
  shift_id?: string | null;
};
export type Shift = {
  id: string;
  slot?: number;
  start_at: number;
  end_at: number;
  kind: "regular" | "extra";
  status: "scheduled" | "cancelled";
  overtime_approved: number;
  work_date: string;
};
export type Rate = {
  effective: number;
  hourlyRate: number | null;
  dailyRule?: { thresholdMinutes: number; hourlyRate: number } | null;
};
export function union(intervals: Interval[]): Interval[] {
  const sorted = intervals
      .filter((i) => i.end > i.start)
      .map((i) => ({ ...i }))
      .sort((a, b) => a.start - b.start || a.end - b.end),
    out: Interval[] = [];
  for (const interval of sorted) {
    const last = out.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else out.push(interval);
  }
  return out;
}
export function intersection(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const left of union(a))
    for (const right of union(b)) {
      const start = Math.max(left.start, right.start),
        end = Math.min(left.end, right.end);
      if (end > start) out.push({ start, end });
    }
  return union(out);
}
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let out = union(a);
  for (const cut of union(b)) {
    out = out.flatMap((i) =>
      cut.end <= i.start || cut.start >= i.end
        ? [i]
        : [
            { start: i.start, end: Math.min(i.end, cut.start) },
            { start: Math.max(i.start, cut.end), end: i.end },
          ].filter((v) => v.end > v.start),
    );
  }
  return out;
}
export const duration = (intervals: Interval[]) =>
  union(intervals).reduce((sum, i) => sum + i.end - i.start, 0);
// Minutes are elapsed whole minutes: start+59 seconds is 0 minutes late, start+60 is 1.
export const lateMinutes = (arrival: number, start: number) =>
  Math.max(0, Math.floor((arrival - start) / 60));

// A physical visit may span both regular windows. Keep the scan intact while
// evaluating each window independently; extra/unscheduled visits stay separate.
export function sessionsForRegularShift<T extends Session>(sessions: T[], shift: Shift, shifts: Shift[]) {
  const regularIds = new Set(shifts.filter((s) => s.kind === "regular" && s.status === "scheduled").map((s) => s.id));
  return sessions.filter((s) => s.shift_id === shift.id ||
    ((s.shift_id === undefined || (s.shift_id != null && regularIds.has(s.shift_id))) &&
      s.check_in < shift.end_at && (s.check_out === null || s.check_out > shift.start_at)))
    .sort((a, b) => a.check_in - b.check_in || (a.id ?? "").localeCompare(b.id ?? ""));
}

export function regularShiftAttendance(sessions: Session[], shifts: Shift[]) {
  return shifts.filter((s) => s.kind === "regular" && s.status === "scheduled")
    .sort((a, b) => a.start_at - b.start_at || a.id.localeCompare(b.id))
    .map((shift) => {
      const records = sessionsForRegularShift(sessions, shift, shifts);
      const arrival = records[0];
      const openSessions = records.filter((s) => s.check_out === null).length;
      const departure = records.length && !openSessions
        ? Math.max(...records.map((s) => s.check_out!)) : null;
      return {
        shiftId: shift.id, start_at: shift.start_at, end_at: shift.end_at,
        lateMinutes: arrival ? lateMinutes(arrival.check_in, shift.start_at) : 0,
        earlyDepartureSeconds: departure === null ? 0
          : Math.min(shift.end_at - shift.start_at, Math.max(0, shift.end_at - departure)),
        openSessions,
      };
    });
}
export function calculateAttendance(
  sessions: Session[],
  shifts: Shift[],
  approvedOvertime: Interval[] = [],
  now = Math.floor(Date.now() / 1000),
) {
  const ordered = [...sessions].sort(
    (a, b) => a.check_in - b.check_in || (a.id ?? "").localeCompare(b.id ?? ""),
  );
  const closed = union(
    ordered
      .filter((s) => s.check_out !== null)
      .map((s) => ({ start: s.check_in, end: s.check_out! })),
  );
  const actual = union(
    ordered.map((s) => ({
      start: s.check_in,
      end: s.check_out ?? Math.min(now, s.check_in + 18 * 3600),
    })),
  );
  let regular: Interval[] = [];
  const regularIds = new Set(shifts.filter((s) => s.kind === "regular" && s.status === "scheduled").map((s) => s.id));
  for (const shift of shifts.filter(
    (s) => s.status === "scheduled" && s.kind === "regular",
  )) {
    const associated = ordered.filter(
      (s) => s.shift_id === undefined || (s.shift_id != null && regularIds.has(s.shift_id) && s.check_in < shift.end_at && (s.check_out === null || s.check_out > shift.start_at)),
    );
    associated.forEach((session, index) => {
      if (session.check_out === null || session.check_out <= session.check_in)
        return;
      let start = Math.max(session.check_in, shift.start_at);
      if (
        index === 0 &&
        session.check_in >= shift.start_at &&
        session.check_in < shift.end_at
      )
        start =
          shift.start_at +
          Math.floor((session.check_in - shift.start_at) / 3600) * 3600;
      const end = Math.min(session.check_out, shift.end_at);
      if (end > start) regular.push({ start, end });
    });
  }
  regular = union(regular);
  const regularWindows = shifts
    .filter((s) => s.kind === "regular" && s.status === "scheduled")
    .map((s) => ({ start: s.start_at, end: s.end_at }));
  const extraWindows = shifts
    .filter(
      (s) =>
        s.kind === "extra" && s.status === "scheduled" && s.overtime_approved,
    )
    .map((s) => ({ start: s.start_at, end: s.end_at }));
  // Extra authorizations never turn gaps into paid time or double-pay regular scheduled windows.
  const overtime = subtract(
    intersection(closed, [...approvedOvertime, ...extraWindows]),
    regularWindows,
  );
  const unapprovedExtra = subtract(subtract(closed, regularWindows), overtime);
  const shiftAttendance = regularShiftAttendance(ordered, shifts);
  return {
    actualSeconds: duration(actual),
    regularSeconds: duration(regular),
    overtimeSeconds: duration(overtime),
    pendingOvertimeSeconds: duration(unapprovedExtra),
    regularIntervals: regular,
    overtimeIntervals: overtime,
    openSessions: ordered.filter((s) => s.check_out === null).length,
    shiftAttendance,
    lateMinutes: shiftAttendance.reduce((n, s) => n + s.lateMinutes, 0),
    earlyDepartureSeconds: shiftAttendance.reduce((n, s) => n + s.earlyDepartureSeconds, 0),
  };
}
export function earnings(intervals: Interval[], rates: Rate[]) {
  const sorted = [...rates].sort((a, b) => a.effective - b.effective);
  let numerator = 0n,
    unratedSeconds = 0;
  for (const interval of union(intervals)) {
    const boundaries = [
      interval.start,
      ...sorted
        .map((r) => r.effective)
        .filter((t) => t > interval.start && t < interval.end),
      interval.end,
    ];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i],
        end = boundaries[i + 1],
        rate = sorted.filter((r) => r.effective <= start).at(-1);
      if (!rate || rate.hourlyRate === null) unratedSeconds += end - start;
      else numerator += BigInt(rate.hourlyRate) * BigInt(end - start);
    }
  }
  return { numerator, unratedSeconds };
}
// Round once, half-up, to whole UZS. BigInt intermediates avoid floating-point salaries.
export function roundUZS(numerator: bigint) {
  const result = (numerator + 1800n) / 3600n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Salary exceeds supported integer range");
  return Number(result);
}
export function dayStart(date: string) {
  return Math.floor(Date.parse(date + "T00:00:00+05:00") / 1000);
}
export function dateRange(from: string, to: string) {
  const out: string[] = [];
  for (
    let t = Date.parse(from + "T00:00:00Z");
    t <= Date.parse(to + "T00:00:00Z");
    t += 86400000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
export function payrollRange(today: string, firstDay: number) {
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(
      Date.UTC(year, month - 1 - (day < firstDay ? 1 : 0), firstDay),
    ),
    next = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, firstDay),
    );
  return {
    from: start.toISOString().slice(0, 10),
    to: new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
  };
}
