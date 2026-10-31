import { describe, it, expect } from "vitest";
import { debtBonus, debtResult, type DebtEntry } from "../shared/debtors";
const entry = (debtors: number, students = 100): DebtEntry => ({
  id: 1, work_date: "2026-10-15", created_at: 1,
  d1: debtors, d2: 0, d3: 0, d4: 0, s1: students, s2: 0, s3: 0,
});
describe("Cashier debt bonus", () => {
  it.each([[0,2.5],[0.001,2],[1.999,2],[2,1.8],[4.999,1.8],[5,1.7],[7,1.6],[8,1.6],[10,1.5],[15,1.4],[20,1.2],[29.999,1.2],[30,1],[100,1],[150,1]])("assigns %s percent to %s× without display rounding", (p,m) => {
    expect(debtResult(entry(Math.round(p * 1000), 100000))!.multiplier).toBe(m);
  });
  it("matches the requested salary example and handles empty data and UZS rounding", () => {
    expect(debtBonus(2000000, entry(8))).toMatchObject({ eligibleEarnings: 2000000, amount: 1200000, multiplier: 1.6 });
    expect(debtBonus(2000000, null)).toMatchObject({ amount: 0, percentage: null });
    expect(debtResult(entry(0,0))).toBeNull();
    expect(debtBonus(1, entry(0)).amount).toBe(2);
    expect(debtBonus(2000000, entry(30)).amount).toBe(0);
  });
});
