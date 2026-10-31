import { payrollRange } from "./attendance";

export type DisciplinePolicy = {
  secondFine: number | null;
  thirdFine: number | null;
  fourthFine: number | null;
  laterFine: number | null;
  laterAction: string;
};
export const initialDisciplinePolicy: DisciplinePolicy = {
  secondFine: null,
  thirdFine: null,
  fourthFine: 0,
  laterFine: null,
  laterAction: "Administrator review required",
};
export type ViolationSource = {
  id: string;
  employee_id: string;
  work_date: string;
  occurred_at: number;
  category: "lateness" | "quality" | "uniform";
  reason: string;
  source_token: string;
};
export type ViolationDecision = {
  violation_id: string;
  source_token: string;
  status: "confirmed" | "excused" | "reversed";
  reason: string;
  decided_by: string;
  decided_at: number;
};
export function disciplineProgression(
  sources: ViolationSource[],
  decisions: ViolationDecision[],
  policy: DisciplinePolicy,
) {
  const counts = new Map<string, number>();
  return [...sources]
    .sort(
      (a, b) =>
        a.work_date.localeCompare(b.work_date) ||
        a.occurred_at - b.occurred_at ||
        a.id.localeCompare(b.id),
    )
    .map((source) => {
      const decision = decisions.find(
        (d) =>
          d.violation_id === source.id &&
          d.source_token === source.source_token,
      );
      const status =
        decision?.status ??
        (source.category === "lateness" ? "detected" : "confirmed");
      const excluded = status === "excused" || status === "reversed";
      const ordinal = excluded ? 0 : (counts.get(source.employee_id) ?? 0) + 1;
      if (!excluded) counts.set(source.employee_id, ordinal);
      const proposedFine =
        ordinal <= 1
          ? 0
          : ordinal === 2
            ? policy.secondFine
            : ordinal === 3
              ? policy.thirdFine
              : ordinal === 4
                ? policy.fourthFine
                : policy.laterFine;
      const action =
        ordinal === 0
          ? "Excluded"
          : ordinal === 1
            ? "Warning"
            : ordinal === 4
              ? "Manager meeting required"
              : ordinal >= 5
                ? policy.laterAction
                : "Fine proposed";
      return {
        ...source,
        status,
        decision: decision ?? null,
        ordinal,
        proposedFine,
        action,
        fineStatus:
          excluded || ordinal <= 1
            ? "none"
            : proposedFine === null
              ? "configuration_required"
              : "proposed",
        meetingRequired: ordinal === 4,
        progressionToken: JSON.stringify([
          source.source_token,
          ordinal,
          proposedFine,
          action,
        ]),
      };
    });
}
export type DisciplineViolation = ReturnType<
  typeof disciplineProgression
>[number];
export function disciplinePeriod(workDate: string, firstDay: number) {
  return payrollRange(workDate, firstDay);
}
