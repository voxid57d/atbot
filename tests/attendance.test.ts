import { describe, it, expect } from "vitest";
import {
  calculateAttendance,
  dayStart,
  earnings,
  roundUZS,
  lateMinutes,
  payrollRange,
  union,
  type Shift,
  type Session,
} from "../shared/attendance";
import { issueQR, verifyQR, qrSignature } from "../backend/qr";
const date = "2026-10-10",
  base = dayStart(date),
  at = (time: string) =>
    base +
    time
      .split(":")
      .reduce((sum, n, i) => sum + Number(n) * [3600, 60, 1][i], 0);
const shift = (start = "08:00", end = "17:00"): Shift => ({
  id: "shift",
  start_at: at(start),
  end_at: at(end),
  kind: "regular",
  status: "scheduled",
  overtime_approved: 0,
  work_date: date,
});
const session = (start: string, end: string | null, id = "a"): Session => ({
  id,
  check_in: at(start),
  check_out: end ? at(end) : null,
  shift_id: "shift",
});
const calc = (
  sessions: Session[],
  shifts = [shift()],
  approvals: { start: number; end: number }[] = [],
) => calculateAttendance(sessions, shifts, approvals, at("19:00"));
describe("Attendance calculations", () => {
  it("preserves paid-start rounding while recording real lateness", () => {
    const result = calc([session("08:12", "17:00")]);
    expect(result.regularSeconds).toBe(9 * 3600);
    expect(result.lateMinutes).toBe(12);
  });
  it("totals lateness per split shift without changing each shift's pay credit", () => {
    const shifts = [shift("08:00", "10:00"), { ...shift("14:00", "18:00"), id: "second" }];
    const result = calc([session("08:00", "10:00"), { ...session("14:12", "18:00", "b"), shift_id: "second" }], shifts);
    expect(result.lateMinutes).toBe(12);
    expect(result.shiftAttendance.map((s) => s.lateMinutes)).toEqual([0, 12]);
    expect(result.regularSeconds).toBe(6 * 3600);
  });
  it("detects the second shift's early departure during a spanning visit", () => {
    const shifts = [shift("08:00", "10:00"), { ...shift("14:00", "18:00"), id: "second" }];
    const result = calc([session("08:00", "17:00")], shifts);
    expect(result.regularSeconds).toBe(5 * 3600);
    expect(result.earlyDepartureSeconds).toBe(3600);
    expect(result.shiftAttendance.map((s) => s.earlyDepartureSeconds)).toEqual([0, 3600]);
  });
  it("does not award credited time for an instant checkout", () => {
    expect(calc([session("08:35", "08:35")]).regularSeconds).toBe(0);
  });
  it.each([
    ["08:00", 108000],
    ["08:01", 108000],
    ["08:35", 108000],
    ["08:59", 108000],
    ["09:00", 96000],
    ["09:25", 96000],
    ["10:00", 84000],
  ])("credits first arrival %s at the scheduled block", (arrival, expected) => {
    const v = calc([session(arrival, "17:00")]);
    expect(
      roundUZS(
        earnings(v.regularIntervals, [{ effective: base, hourlyRate: 12000 }])
          .numerator,
      ),
    ).toBe(expected);
    expect(v.regularSeconds).toBeLessThanOrEqual(9 * 3600);
  });
  it.each([
    ["08:35", "16:30", 102000],
    ["09:20", "16:30", 90000],
  ])("keeps early checkout exact for %s–%s", (arrival, end, expected) => {
    const v = calc([session(arrival, end)]);
    expect(
      roundUZS(
        earnings(v.regularIntervals, [{ effective: base, hourlyRate: 12000 }])
          .numerator,
      ),
    ).toBe(expected);
    expect(v.earlyDepartureSeconds).toBe(1800);
  });
  it.each([
    ["08:59", 9 * 3600],
    ["09:29", 9 * 3600],
    ["09:30", 8 * 3600],
  ])("anchors blocks at 08:30 for %s", (arrival, expected) =>
    expect(
      calc([session(arrival, "17:30")], [shift("08:30", "17:30")])
        .regularSeconds,
    ).toBe(expected),
  );
  it("leaves gaps unpaid and does not round returning sessions", () => {
    const v = calc([session("08:35", "12:00"), session("13:25", "17:00", "b")]);
    expect(v.actualSeconds).toBe(7 * 3600);
    expect(v.regularSeconds).toBe(7 * 3600 + 35 * 60);
    expect(v.lateMinutes).toBe(35);
  });
  it("unions duplicates and overlapping sessions", () => {
    const v = calc([
      session("08:35", "13:00"),
      session("12:00", "17:00", "b"),
      session("12:00", "17:00", "c"),
    ]);
    expect(v.actualSeconds).toBe(8 * 3600 + 25 * 60);
    expect(v.regularSeconds).toBe(9 * 3600);
  });
  it("keeps actual seconds separate from credited seconds", () => {
    const v = calc([session("08:35:10", "16:30:25")]);
    expect(v.actualSeconds).toBe(7 * 3600 + 55 * 60 + 15);
    expect(v.regularSeconds).toBe(8 * 3600 + 30 * 60 + 25);
  });
  it("never rounds an unscheduled session", () => {
    const v = calc([{ ...session("08:35", "17:00"), shift_id: null }], []);
    expect(v.regularSeconds).toBe(0);
    expect(v.pendingOvertimeSeconds).toBe(8 * 3600 + 25 * 60);
  });
  it("separates approved overtime without paying gaps or overlap", () => {
    const v = calc(
      [session("07:30", "12:00"), session("13:00", "19:00", "b")],
      [shift()],
      [
        { start: at("07:00"), end: at("20:00") },
        { start: at("16:00"), end: at("21:00") },
      ],
    );
    expect(v.regularSeconds).toBe(8 * 3600);
    expect(v.overtimeSeconds).toBe(2.5 * 3600);
    expect(v.pendingOvertimeSeconds).toBe(0);
  });
  it("requires extra shift approval and pays only actual closed intervals", () => {
    const extra = {
      ...shift("19:00", "21:00"),
      id: "extra",
      kind: "extra" as const,
    };
    const s = { ...session("19:25", "20:30"), shift_id: "extra" };
    expect(calc([s], [extra]).overtimeSeconds).toBe(0);
    expect(
      calc([s], [{ ...extra, overtime_approved: 1 }]).overtimeSeconds,
    ).toBe(65 * 60);
  });
  it("caps open actual sessions and excludes all open estimated pay", () => {
    const v = calculateAttendance(
      [session("08:35", null)],
      [shift()],
      [{ start: at("17:00"), end: at("22:00") }],
      base + 4 * 86400,
    );
    expect(v.actualSeconds).toBe(18 * 3600);
    expect(v.regularSeconds).toBe(0);
    expect(v.overtimeSeconds).toBe(0);
    expect(v.openSessions).toBe(1);
  });
  it("does not move first-arrival rounding to a subsequent closed session", () => {
    const v = calc([session("08:35", null), session("10:25", "12:00", "b")]);
    expect(v.regularSeconds).toBe(95 * 60);
  });
  it("ignores cancelled regular shifts", () =>
    expect(
      calc([session("08:35", "17:00")], [{ ...shift(), status: "cancelled" }])
        .regularSeconds,
    ).toBe(0));
  it("uses whole elapsed minutes for lateness, including seconds boundary", () => {
    expect(lateMinutes(at("08:00:59"), at("08:00"))).toBe(0);
    expect(lateMinutes(at("08:01:00"), at("08:00"))).toBe(1);
    expect(lateMinutes(at("07:50"), at("08:00"))).toBe(0);
  });
  it("splits earnings at historical rate boundaries", () => {
    const v = earnings(
      [{ start: base, end: base + 2 * 86400 }],
      [
        { effective: base, hourlyRate: 12000 },
        { effective: base + 86400, hourlyRate: 15000 },
      ],
    );
    expect(roundUZS(v.numerator)).toBe(24 * 27000);
  });
  it("reports unrated time rather than treating it as zero wages", () => {
    const v = earnings(
      [{ start: base, end: base + 7200 }],
      [{ effective: base + 3600, hourlyRate: null }],
    );
    expect(v.unratedSeconds).toBe(7200);
    expect(v.numerator).toBe(0n);
  });
  it("rounds money once using integer half-up UZS", () => {
    expect(roundUZS(1799n)).toBe(0);
    expect(roundUZS(1800n)).toBe(1);
    expect(roundUZS(1800n + 1800n)).toBe(1);
    expect(() =>
      roundUZS(BigInt(Number.MAX_SAFE_INTEGER) * 3600n + 3600n),
    ).toThrow();
  });
  it("uses Tashkent dates and payroll periods across year boundaries", () => {
    expect(dayStart(date)).toBe(Date.parse("2026-10-09T19:00:00Z") / 1000);
    expect(payrollRange("2026-01-03", 5)).toEqual({
      from: "2025-12-05",
      to: "2026-01-04",
    });
    expect(payrollRange("2026-02-05", 5)).toEqual({
      from: "2026-02-05",
      to: "2026-03-04",
    });
  });
  it("does not mutate input intervals", () => {
    const input = [
      { start: 2, end: 5 },
      { start: 1, end: 3 },
    ];
    expect(union(input)).toEqual([{ start: 1, end: 5 }]);
    expect(input[0].end).toBe(5);
  });
});
describe("Signed reception QR", () => {
  const id = "f7b1cfe4-826a-42b4-83dd-13ae39ec48cf",
    secret = "test-only";
  it("provides one full minute even when issued near a clock boundary", async () => {
    const a = await issueQR(id, secret, 899);
    expect(a.expiresAt).toBe(959);
    expect((await verifyQR(a.token, secret, 958)).d).toBe(id);
    await expect(verifyQR(a.token, secret, 959)).rejects.toThrow();
  });
  it("rejects expired and future tokens", async () => {
    const { token } = await issueQR(id, secret, 600);
    await expect(verifyQR(token, secret, 900)).rejects.toThrow();
    await expect(verifyQR(token, secret, 599)).rejects.toThrow();
  });
  it("rejects tampered payloads, signatures, and different signing keys", async () => {
    const { token } = await issueQR(id, secret, 600);
    await expect(
      verifyQR(
        token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"),
        secret,
        610,
      ),
    ).rejects.toThrow();
    await expect(verifyQR(token, "other", 610)).rejects.toThrow();
    await expect(
      verifyQR("http://evil.example", secret, 610),
    ).rejects.toThrow();
  });
  it("rejects malformed signed payloads and arbitrary expiration", async () => {
    const encoded = btoa(
      JSON.stringify({ v: 1, d: id, w: 600, e: 661 }),
    ).replaceAll("=", "");
    const token =
      "ATBOT1:" + encoded + "." + (await qrSignature(encoded, secret));
    await expect(verifyQR(token, secret, 610)).rejects.toThrow();
  });
  it("rejects obsolete QR lifetimes", async () => {
    const encoded = btoa(
      JSON.stringify({ v: 1, d: id, w: 600, e: 630 }),
    ).replaceAll("=", "");
    const token =
      "ATBOT1:" + encoded + "." + (await qrSignature(encoded, secret));
    await expect(verifyQR(token, secret, 629)).rejects.toThrow();
    await expect(verifyQR(token, secret, 630)).rejects.toThrow();
  });
});
