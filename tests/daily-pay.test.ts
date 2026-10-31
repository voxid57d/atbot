import { describe, it, expect } from "vitest";
import { payrollEarnings } from "../shared/payroll";
import { dayStart } from "../shared/attendance";
const date = "2026-10-11",
  start = dayStart(date);
const rate = [
  {
    effective: 0,
    hourlyRate: 12000,
    dailyRule: { thresholdMinutes: 480, hourlyRate: 20000 },
  },
];
const shift = (d = date) => ({
  id: d,
  work_date: d,
  start_at: dayStart(d) + 8 * 3600,
  end_at: dayStart(d) + 18 * 3600,
  kind: "regular" as const,
  status: "scheduled" as const,
  overtime_approved: 0,
});
const session = (hours: number, d = date) => ({
  work_date: d,
  shift_id: d,
  check_in: dayStart(d) + 8 * 3600,
  check_out: dayStart(d) + (8 + hours) * 3600,
});
describe("daily extended-hours replacement rate", () => {
  it("keeps eight hours at the normal rate and pays completed hours above it", () => {
    expect(
      payrollEarnings(date, date, [session(8)], [shift()], [], rate)
        .workedGross,
    ).toBe(96000);
    const pay = payrollEarnings(
      date,
      date,
      [session(9.5)],
      [shift()],
      [],
      rate,
    );
    expect(pay.workedGross).toBe(116000);
    expect(pay.paidSeconds).toBe(9 * 3600);
    expect(pay.days[0].thresholdSeconds).toBe(3600);
  });
  it("combines visits without counting gaps and resets the count daily", () => {
    const next = "2026-10-12";
    const pay = payrollEarnings(
      date,
      next,
      [
        session(4),
        {
          work_date: date,
          shift_id: date,
          check_in: start + 13 * 3600,
          check_out: start + 18 * 3600,
        },
        session(8, next),
      ],
      [shift(), shift(next)],
      [],
      rate,
    );
    expect(pay.workedGross).toBe(116000 + 96000);
    expect(pay.days.map((d) => d.thresholdSeconds)).toEqual([3600, 0]);
  });
  it("counts only approved overtime and allocates chronological early overtime correctly", () => {
    const sessions = [
      {
        work_date: date,
        shift_id: date,
        check_in: start + 6 * 3600,
        check_out: start + 18 * 3600,
      },
    ];
    const regular = { ...shift(), end_at: start + 17 * 3600 };
    const noApproval = payrollEarnings(
      date,
      date,
      sessions,
      [regular],
      [],
      rate,
    );
    expect(noApproval.workedGross).toBe(116000);
    const pay = payrollEarnings(
      date,
      date,
      sessions,
      [regular],
      [
        {
          work_date: date,
          start_at: start + 6 * 3600,
          end_at: start + 8 * 3600,
        },
      ],
      rate,
    );
    expect(pay.workedGross).toBe(156000);
    expect(pay.basePay).toBe(132000);
    expect(pay.overtimePay).toBe(24000);
  });
  it("preserves earlier dates when the rule starts later, and supports disabling", () => {
    const next = "2026-10-12";
    const rates = [
      { effective: 0, hourlyRate: 12000 },
      {
        effective: dayStart(next),
        hourlyRate: 12000,
        dailyRule: rate[0].dailyRule,
      },
    ];
    expect(
      payrollEarnings(
        date,
        next,
        [session(9), session(9, next)],
        [shift(), shift(next)],
        [],
        rates,
      ).workedGross,
    ).toBe(224000);
    expect(
      payrollEarnings(
        next,
        next,
        [session(9, next)],
        [shift(next)],
        [],
        [
          ...rates,
          { effective: dayStart(next), hourlyRate: 12000, dailyRule: null },
        ],
      ).workedGross,
    ).toBe(108000);
  });
  it("supports a lower or zero replacement rate and never masks missing normal rates", () => {
    expect(
      payrollEarnings(
        date,
        date,
        [session(9)],
        [shift()],
        [],
        [{ ...rate[0], dailyRule: { thresholdMinutes: 480, hourlyRate: 0 } }],
      ).workedGross,
    ).toBe(96000);
    const missing = payrollEarnings(
      date,
      date,
      [session(9)],
      [shift()],
      [],
      [{ ...rate[0], hourlyRate: null }],
    );
    expect(missing.workedGross).toBe(0);
    expect(missing.unratedSeconds).toBe(9 * 3600);
  });
});
