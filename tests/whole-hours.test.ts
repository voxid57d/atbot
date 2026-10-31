import { describe, it, expect } from "vitest";
import {
  dailyEarnings,
  payrollEarnings,
  additionalPaidSeconds,
} from "../shared/payroll";
import { dayStart } from "../shared/attendance";
const rates = [{ effective: 0, hourlyRate: 11000 }];
const interval = (start: number, minutes: number) => ({
  start,
  end: start + minutes * 60,
});
describe("completed payable hours per day", () => {
  it("ignores unpaid remainders that cannot add pay, but combines remainders when they complete an hour", () => {
    expect(additionalPaidSeconds(132 * 60, 60)).toBe(0);
    expect(additionalPaidSeconds(120 * 60, 59 * 60)).toBe(0);
    expect(additionalPaidSeconds(179 * 60, 2 * 60)).toBe(3600);
    expect(additionalPaidSeconds(120 * 60, 60 * 60)).toBe(3600);
    expect(additionalPaidSeconds(0, 59 * 60)).toBe(0);
  });
  it.each([
    [59, 0],
    [60, 1],
    [132, 2],
    [179, 2],
    [180, 3],
  ])("floors %i minutes to %i hours", (minutes, hours) => {
    const result = dailyEarnings([], [interval(0, minutes)], rates);
    expect(result.paidSeconds).toBe(hours * 3600);
    expect(result.overtime.numerator).toBe(BigInt(hours * 3600 * 11000));
    expect(result.discardedSeconds).toBe((minutes % 60) * 60);
  });
  it("combines visits and regular/overtime without counting gaps or duplicates", () => {
    const result = dailyEarnings(
      [interval(0, 40), interval(0, 40)],
      [interval(7200, 40)],
      rates,
    );
    expect(result.paidSeconds).toBe(3600);
    expect(result.regular.numerator + result.overtime.numerator).toBe(
      39600000n,
    );
    expect(result.discardedSeconds).toBe(1200);
  });
  it("never carries leftover minutes into the next day or month", () => {
    const dates = ["2026-09-30", "2026-10-01"];
    const sessions = dates.map((work_date) => ({
      work_date,
      check_in: dayStart(work_date),
      check_out: dayStart(work_date) + 59 * 60,
    }));
    const approvals = dates.map((work_date) => ({
      work_date,
      start_at: dayStart(work_date),
      end_at: dayStart(work_date) + 59 * 60,
    }));
    const result = payrollEarnings(
      dates[0],
      dates[1],
      sessions,
      [],
      approvals,
      rates,
    );
    expect(result.workedGross).toBe(0);
    expect(result.paidSeconds).toBe(0);
    expect(result.actualSeconds).toBe(118 * 60);
  });
  it("keeps historical rates in time order when visits combine into a paid hour", () => {
    const result = dailyEarnings(
      [],
      [interval(0, 30), interval(7200, 45)],
      [
        { effective: 0, hourlyRate: 10000 },
        { effective: 7200, hourlyRate: 20000 },
      ],
    );
    expect(result.overtime.numerator / 3600n).toBe(15000n);
    expect(result.paidSeconds).toBe(3600);
  });
});
