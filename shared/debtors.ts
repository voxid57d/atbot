// Feature starts on this Tashkent business date. Entries affect their payroll month.
export const DEBTORS_START = "2026-10-15";
export const debtorFields = ["d1", "d2", "d3", "d4", "s1", "s2", "s3"] as const;
export type DebtorCounts = Record<(typeof debtorFields)[number], number>;
export type DebtEntry = DebtorCounts & {
  id: number;
  work_date: string;
  created_at: number;
};
export const debtBands = [
  { from: 0, to: 0, multiplier: 2.5, label: "Exactly 0%" },
  { from: 0, to: 2, multiplier: 2, label: "Above 0% to below 2%" },
  { from: 2, to: 5, multiplier: 1.8, label: "2% to below 5%" },
  { from: 5, to: 7, multiplier: 1.7, label: "5% to below 7%" },
  { from: 7, to: 10, multiplier: 1.6, label: "7% to below 10%" },
  { from: 10, to: 15, multiplier: 1.5, label: "10% to below 15%" },
  { from: 15, to: 20, multiplier: 1.4, label: "15% to below 20%" },
  { from: 20, to: 30, multiplier: 1.2, label: "20% to below 30%" },
  { from: 30, to: Infinity, multiplier: 1, label: "30% and above" },
];
export function debtResult(counts: DebtorCounts) {
  const debtors = counts.d1 + counts.d2 + counts.d3 + counts.d4;
  const students = counts.s1 + counts.s2 + counts.s3;
  if (students <= 0) return null;
  // Compare counts directly: rounding the displayed percent must not change a band.
  const band = debtors === 0 ? debtBands[0] : debtBands.slice(1).find(
    (b) => debtors * 100 < students * b.to,
  )!;
  return { debtors, students, percentage: debtors / students * 100, multiplier: band.multiplier };
}
export function debtBonus(eligibleEarnings: number, entry: DebtEntry | null) {
  const result = entry ? debtResult(entry) : null;
  const tenths = Math.round((result?.multiplier ?? 1) * 10) - 10;
  const amount = Number((BigInt(eligibleEarnings) * BigInt(tenths) + 5n) / 10n);
  if (!Number.isSafeInteger(amount + eligibleEarnings)) throw new Error("Salary exceeds the supported integer range");
  return { eligibleEarnings, amount, percentage: result?.percentage ?? null,
    multiplier: result?.multiplier ?? 1, entryId: entry?.id ?? null,
    entryDate: entry?.work_date ?? null };
}
export type CashierBonus = ReturnType<typeof debtBonus>;
