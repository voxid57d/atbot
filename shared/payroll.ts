import {
  calculateAttendance,
  roundUZS,
  dateRange,
  type Session,
  type Shift,
  type Rate,
  type Interval,
  union,
} from "./attendance";
// Count all payable intervals in time order, resetting the threshold each day.
// Regular and approved overtime retain their labels; the threshold replaces their rate.
export function dailyEarnings(
  regularIntervals: Interval[],
  overtimeIntervals: Interval[],
  rates: Rate[],
) {
  const sorted = [...rates].sort((a, b) => a.effective - b.effective);
  const regular = { numerator: 0n, unratedSeconds: 0 },
    overtime = { numerator: 0n, unratedSeconds: 0 };
  let countedSeconds = 0,
    thresholdSeconds = 0;
  const intervals = [
    ...union(regularIntervals).map((i) => ({ ...i, kind: "regular" as const })),
    ...union(overtimeIntervals).map((i) => ({
      ...i,
      kind: "overtime" as const,
    })),
  ].sort((a, b) => a.start - b.start);
  // Combine visits and regular/overtime before flooring, once per employee/day.
  // Keep the earliest payable time, dropping only the final partial hour.
  const eligibleSeconds = intervals.reduce(
    (sum, i) => sum + i.end - i.start,
    0,
  );
  const paidSeconds = Math.floor(eligibleSeconds / 3600) * 3600;
  for (const interval of intervals) {
    const paidEnd =
      interval.start +
      Math.min(interval.end - interval.start, paidSeconds - countedSeconds);
    if (paidEnd <= interval.start) break;
    const result = interval.kind === "regular" ? regular : overtime;
    const boundaries = [
      interval.start,
      ...sorted
        .map((r) => r.effective)
        .filter((t) => t > interval.start && t < paidEnd),
      paidEnd,
    ];
    for (let n = 0; n < boundaries.length - 1; n++) {
      const start = boundaries[n],
        seconds = boundaries[n + 1] - start;
      const rate = sorted.filter((r) => r.effective <= start).at(-1);
      if (!rate || rate.hourlyRate === null) result.unratedSeconds += seconds;
      else {
        const special = rate.dailyRule
          ? Math.min(
              seconds,
              Math.max(
                0,
                countedSeconds + seconds - rate.dailyRule.thresholdMinutes * 60,
              ),
            )
          : 0;
        result.numerator +=
          BigInt(rate.hourlyRate) * BigInt(seconds - special) +
          BigInt(rate.dailyRule?.hourlyRate ?? rate.hourlyRate) *
            BigInt(special);
        thresholdSeconds += special;
      }
      countedSeconds += seconds;
    }
  }
  return {
    regular,
    overtime,
    thresholdSeconds,
    paidSeconds,
    discardedSeconds: eligibleSeconds - paidSeconds,
  };
}
export type PayrollSession = Session & { work_date: string };
// A remainder needs a salary decision only if approving it could add paid hours.
// Include credited remainders: 2h59m credited + 2m pending can add one hour.
export function additionalPaidSeconds(
  eligibleSeconds: number,
  pendingSeconds: number,
) {
  return (
    (Math.floor((eligibleSeconds + pendingSeconds) / 3600) -
      Math.floor(eligibleSeconds / 3600)) *
    3600
  );
}
export type PayrollApproval = {
  work_date: string;
  start_at: number;
  end_at: number;
};
export type PayrollAdjustment = {
  id: string;
  kind: "bonus" | "deduction" | "advance" | "leave_pay";
  amount: number;
  work_date: string;
  reason: string;
  status: string;
};
export function payrollEarnings(
  from: string,
  to: string,
  sessions: PayrollSession[],
  shifts: Shift[],
  approvals: PayrollApproval[],
  rates: Rate[],
) {
  let regularNumerator = 0n,
    overtimeNumerator = 0n;
  const days = dateRange(from, to).map((date) => {
    const calculation = calculateAttendance(
      sessions.filter((s) => s.work_date === date),
      shifts.filter((s) => s.work_date === date),
      approvals
        .filter((a) => a.work_date === date)
        .map((a) => ({ start: a.start_at, end: a.end_at })),
    );
    const {
      regular,
      overtime,
      thresholdSeconds,
      paidSeconds,
      discardedSeconds,
    } = dailyEarnings(
      calculation.regularIntervals,
      calculation.overtimeIntervals,
      rates,
    );
    regularNumerator += regular.numerator;
    overtimeNumerator += overtime.numerator;
    return {
      date,
      ...calculation,
      pendingPaidSeconds: additionalPaidSeconds(
        calculation.regularSeconds + calculation.overtimeSeconds,
        calculation.pendingOvertimeSeconds,
      ),
      thresholdSeconds,
      paidSeconds,
      discardedSeconds,
      unratedSeconds: regular.unratedSeconds + overtime.unratedSeconds,
      regularNumerator: regular.numerator.toString(),
      overtimeNumerator: overtime.numerator.toString(),
      grossEstimate: roundUZS(regular.numerator + overtime.numerator),
    };
  });
  const basePay = roundUZS(regularNumerator),
    workedGross = roundUZS(regularNumerator + overtimeNumerator);
  return {
    days,
    actualSeconds: days.reduce((s, d) => s + d.actualSeconds, 0),
    regularSeconds: days.reduce((s, d) => s + d.regularSeconds, 0),
    overtimeSeconds: days.reduce((s, d) => s + d.overtimeSeconds, 0),
    paidSeconds: days.reduce((s, d) => s + d.paidSeconds, 0),
    discardedSeconds: days.reduce((s, d) => s + d.discardedSeconds, 0),
    basePay,
    overtimePay: workedGross - basePay,
    workedGross,
    unratedSeconds: days.reduce((s, d) => s + d.unratedSeconds, 0),
    regularNumerator: regularNumerator.toString(),
    overtimeNumerator: overtimeNumerator.toString(),
    rates,
  };
}
export function payrollTotals(
  workedGross: number,
  adjustments: PayrollAdjustment[],
  approvedFines: number[],
) {
  const approved = adjustments.filter((a) => a.status === "approved");
  const sum = (amounts: number[]) => {
    const result = amounts.reduce((n, a) => n + BigInt(a), 0n);
    if (
      result > BigInt(Number.MAX_SAFE_INTEGER) ||
      result < BigInt(Number.MIN_SAFE_INTEGER)
    )
      throw new Error("Payroll exceeds the supported integer range");
    return Number(result);
  };
  const bonuses = sum(
    approved.filter((a) => a.kind === "bonus").map((a) => a.amount),
  );
  const leavePay = sum(
    approved.filter((a) => a.kind === "leave_pay").map((a) => a.amount),
  );
  const deductions = sum(
    approved.filter((a) => a.kind === "deduction").map((a) => a.amount),
  );
  const advances = sum(
    approved.filter((a) => a.kind === "advance").map((a) => a.amount),
  );
  const fines = sum(approvedFines);
  return {
    bonuses,
    leavePay,
    deductions,
    advances,
    fines,
    finalPay: sum([
      workedGross,
      bonuses,
      leavePay,
      -deductions,
      -advances,
      -fines,
    ]),
  };
}
export function payrollCSV(
  entries: {
    fullName: string;
    employeeId: string;
    actualSeconds: number;
    paidSeconds?: number;
    regularSeconds: number;
    overtimeSeconds: number;
    basePay: number;
    overtimePay: number;
    bonuses: number;
    cashierBonus?: { eligibleEarnings: number; amount: number; percentage: number | null; multiplier: number; entryId: number | null } | null;
    leavePay: number;
    deductions: number;
    advances: number;
    fines: number;
    finalPay: number;
  }[],
  period: { from: string; to: string },
) {
  const cell = (value: string | number) => {
    let s = String(value);
    if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const hasHistoricalAdvance = entries.some((e) => e.advances !== 0);
  const hasCashierBonus = entries.some((e) => e.cashierBonus);
  const header = [
    "From",
    "To",
    "Employee ID",
    "Employee",
    "Actual seconds",
    "Paid seconds (daily completed hours)",
    "Credited regular seconds",
    "Approved overtime seconds",
    "Base UZS",
    "Overtime UZS",
    "Bonus UZS",
    ...(hasCashierBonus ? ["Cashier eligible earnings UZS", "Debt percentage", "Debt multiplier", "Cashier debt bonus UZS (included in bonus)", "Debt entry ID"] : []),
    "Paid leave UZS",
    "Deductions UZS",
    ...(hasHistoricalAdvance ? ["Historical advance UZS"] : []),
    "Fines UZS",
    "Final pay UZS",
  ];
  return (
    "\uFEFF" +
    [
      header,
      ...entries.map((e) => [
        period.from,
        period.to,
        e.employeeId,
        e.fullName,
        e.actualSeconds,
        e.paidSeconds ?? e.regularSeconds + e.overtimeSeconds,
        e.regularSeconds,
        e.overtimeSeconds,
        e.basePay,
        e.overtimePay,
        e.bonuses,
        ...(hasCashierBonus ? [e.cashierBonus?.eligibleEarnings ?? "", e.cashierBonus?.percentage ?? "", e.cashierBonus?.multiplier ?? "", e.cashierBonus?.amount ?? "", e.cashierBonus?.entryId ?? ""] : []),
        e.leavePay,
        e.deductions,
        ...(hasHistoricalAdvance ? [e.advances] : []),
        e.fines,
        e.finalPay,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n") +
    "\r\n"
  );
}
