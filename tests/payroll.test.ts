import { describe, it, expect } from "vitest";
import {
  payrollEarnings,
  payrollTotals,
  payrollCSV,
  type PayrollAdjustment,
} from "../shared/payroll";
import { dayStart } from "../shared/attendance";
const date = "2026-09-15",
  start = dayStart(date),
  shift = {
    id: "shift",
    work_date: date,
    start_at: start + 8 * 3600,
    end_at: start + 17 * 3600,
    kind: "regular" as const,
    status: "scheduled" as const,
    overtime_approved: 0,
  };
const rate = [{ effective: dayStart("2026-01-01"), hourlyRate: 12000 }];
describe("Phase 5 payroll calculations", () => {
  it("preserves late-arrival credit and floors daily payable hours after early departure", () => {
    for (const [arrival, checkout, expected] of [
      [8 * 3600, 17 * 3600, 108000],
      [8 * 3600 + 35 * 60, 17 * 3600, 108000],
      [9 * 3600, 17 * 3600, 96000],
      [8 * 3600 + 35 * 60, 16.5 * 3600, 96000],
      [9 * 3600 + 20 * 60, 16.5 * 3600, 84000],
    ]) {
      expect(
        payrollEarnings(
          date,
          date,
          [
            {
              work_date: date,
              shift_id: "shift",
              check_in: start + arrival,
              check_out: start + checkout,
            },
          ],
          [shift],
          [],
          rate,
        ).workedGross,
      ).toBe(expected);
    }
  });
  it("uses historical wage changes and rounds combined monthly earnings once", () => {
    const d2 = "2026-09-16",
      second = {
        ...shift,
        id: "second",
        work_date: d2,
        start_at: dayStart(d2) + 8 * 3600,
        end_at: dayStart(d2) + 17 * 3600,
      };
    const e = payrollEarnings(
      date,
      d2,
      [
        {
          work_date: date,
          shift_id: "shift",
          check_in: shift.start_at,
          check_out: shift.end_at,
        },
        {
          work_date: d2,
          shift_id: "second",
          check_in: second.start_at,
          check_out: second.end_at,
        },
      ],
      [shift, second],
      [],
      [...rate, { effective: dayStart(d2), hourlyRate: 13000 }],
    );
    expect(e.workedGross).toBe(225000);
  });
  it("never credits unapproved overtime and avoids duplicate overlapping approvals", () => {
    const s = {
      work_date: date,
      shift_id: "shift",
      check_in: shift.start_at,
      check_out: shift.end_at + 3600,
    };
    expect(
      payrollEarnings(date, date, [s], [shift], [], rate).overtimePay,
    ).toBe(0);
    const a = {
      work_date: date,
      start_at: shift.end_at,
      end_at: shift.end_at + 3600,
    };
    const e = payrollEarnings(date, date, [s], [shift], [a, a], rate);
    expect(e.overtimePay).toBe(12000);
    expect(e.workedGross).toBe(120000);
  });
  it("allocates regular and overtime money so the displayed lines sum to the single rounded total", () => {
    const short = { ...shift, end_at: shift.start_at + 1 },
      s = {
        work_date: date,
        shift_id: "shift",
        check_in: shift.start_at,
        check_out: shift.start_at + 2,
      };
    const e = payrollEarnings(
      date,
      date,
      [s],
      [short],
      [{ work_date: date, start_at: short.end_at, end_at: short.end_at + 1 }],
      [{ effective: start, hourlyRate: 1800 }],
    );
    expect(e.basePay + e.overtimePay).toBe(e.workedGross);
    expect(e.workedGross).toBe(0);
  });
  it("only approved manual adjustments and approved fines affect final pay", () => {
    const adjustment = (
      kind: PayrollAdjustment["kind"],
      amount: number,
      status = "approved",
    ): PayrollAdjustment => ({
      id: kind,
      kind,
      amount,
      status,
      work_date: date,
      reason: "Approved test",
    });
    const out = payrollTotals(
      108000,
      [
        adjustment("bonus", 10000),
        adjustment("leave_pay", 5000),
        adjustment("deduction", 2000),
        adjustment("advance", 1000),
        adjustment("bonus", 999999, "pending"),
        adjustment("deduction", 999999, "reversed"),
      ],
      [20000],
    );
    expect(out.finalPay).toBe(100000);
  });
  it("does not clamp a negative salary silently", () =>
    expect(
      payrollTotals(
        0,
        [
          {
            id: "a",
            kind: "advance",
            amount: 1000,
            status: "approved",
            work_date: date,
            reason: "Test advance",
          },
        ],
        [],
      ).finalPay,
    ).toBe(-1000));
  it("rejects integer overflow in adjustments", () =>
    expect(() =>
      payrollTotals(
        Number.MAX_SAFE_INTEGER,
        [
          {
            id: "a",
            kind: "bonus",
            amount: 1,
            status: "approved",
            work_date: date,
            reason: "Test overflow",
          },
        ],
        [],
      ),
    ).toThrow());
  it("exports UTF-8 CSV and neutralizes spreadsheet formulas in names", () => {
    const e = {
      employeeId: "e",
      fullName: ' =HYPERLINK("danger")',
      actualSeconds: 3600,
      regularSeconds: 3600,
      overtimeSeconds: 0,
      basePay: 12000,
      overtimePay: 0,
      ...payrollTotals(12000, [], []),
    };
    const csv = payrollCSV([e], { from: date, to: date });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\' =HYPERLINK(""danger"")"');
    expect(csv).toContain("Final pay UZS");
  });
});
