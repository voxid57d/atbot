import { describe, it, expect } from "vitest";
import {
  disciplineProgression,
  disciplinePeriod,
  initialDisciplinePolicy,
  type ViolationSource,
  type ViolationDecision,
} from "../shared/discipline";
import { calculateAttendance } from "../shared/attendance";
const source = (
  n: number,
  extra: Partial<ViolationSource> = {},
): ViolationSource => ({
  id: `v${n}`,
  employee_id: "employee",
  work_date: `2026-10-${String(n).padStart(2, "0")}`,
  occurred_at: n,
  category: "lateness",
  reason: "Late",
  source_token: `t${n}`,
  ...extra,
});
const policy = {
  ...initialDisciplinePolicy,
  secondFine: 20000,
  thirdFine: 40000,
  laterFine: 10000,
};
describe("monthly disciplinary progression", () => {
  it("uses warnings, cumulative configurable fines, a fourth meeting and repeating later policy", () => {
    const out = disciplineProgression(
      [source(5), source(3), source(1), source(4), source(2), source(6)],
      [],
      policy,
    );
    expect(out.map((v) => v.proposedFine)).toEqual([
      0, 20000, 40000, 0, 10000, 10000,
    ]);
    expect(out.reduce((s, v) => s + (v.proposedFine ?? 0), 0)).toBe(80000);
    expect(out[0].action).toBe("Warning");
    expect(out[3].meetingRequired).toBe(true);
  });
  it("does not invent fine amounts", () => {
    const out = disciplineProgression(
      [source(1), source(2), source(3)],
      [],
      initialDisciplinePolicy,
    );
    expect(out.map((v) => v.proposedFine)).toEqual([0, null, null]);
    expect(out[1].fineStatus).toBe("configuration_required");
  });
  it("reversal deterministically shifts subsequent proposals and the manager meeting", () => {
    const d: ViolationDecision = {
      violation_id: "v2",
      source_token: "t2",
      status: "reversed",
      reason: "Evidence reviewed",
      decided_by: "admin",
      decided_at: 100,
    };
    const out = disciplineProgression(
      [1, 2, 3, 4, 5].map((n) => source(n)),
      [d],
      policy,
    );
    expect(out.map((v) => v.ordinal)).toEqual([1, 0, 2, 3, 4]);
    expect(out.map((v) => v.proposedFine)).toEqual([0, 0, 20000, 40000, 0]);
    expect(out[4].meetingRequired).toBe(true);
    expect(
      disciplineProgression(
        [1, 2, 3, 4, 5].map((n) => source(n)),
        [d],
        policy,
      ),
    ).toEqual(out);
  });
  it("uses a stable tie-breaker for different violations on the same day", () => {
    const a = source(1, { id: "uniform", category: "uniform" }),
      b = source(1, { id: "quality", category: "quality" });
    expect(disciplineProgression([a, b], [], policy).map((v) => v.id)).toEqual([
      "quality",
      "uniform",
    ]);
    expect(disciplineProgression([b, a], [], policy)).toEqual(
      disciplineProgression([a, b], [], policy),
    );
  });
  it("keeps employee counters independent", () => {
    const out = disciplineProgression(
      [source(1), source(2, { employee_id: "other" }), source(3)],
      [],
      policy,
    );
    expect(out.map((v) => v.ordinal)).toEqual([1, 1, 2]);
  });
  it("does not apply an old excuse after underlying attendance changes", () => {
    const out = disciplineProgression(
      [source(1)],
      [
        {
          violation_id: "v1",
          source_token: "old",
          status: "excused",
          reason: "Reviewed",
          decided_by: "admin",
          decided_at: 100,
        },
      ],
      policy,
    );
    expect(out[0].ordinal).toBe(1);
    expect(out[0].status).toBe("detected");
  });
  it("resets using configured payroll-month boundaries", () => {
    expect(disciplinePeriod("2026-10-10", 15)).toEqual({
      from: "2026-09-15",
      to: "2026-10-14",
    });
    expect(disciplinePeriod("2026-10-15", 15)).toEqual({
      from: "2026-10-15",
      to: "2026-11-14",
    });
    expect(disciplineProgression([source(1)], [], policy)[0].ordinal).toBe(1);
  });
  it("excusing discipline does not alter attendance or its special payroll rounding", () => {
    const sessions = [
      { check_in: 8 * 3600 + 35 * 60, check_out: 17 * 3600, shift_id: "shift" },
    ];
    const shifts = [
      {
        id: "shift",
        work_date: "2026-10-01",
        start_at: 8 * 3600,
        end_at: 17 * 3600,
        kind: "regular" as const,
        status: "scheduled" as const,
        overtime_approved: 0,
      },
    ];
    const before = calculateAttendance(sessions, shifts);
    disciplineProgression(
      [source(1)],
      [
        {
          violation_id: "v1",
          source_token: "t1",
          status: "excused",
          reason: "Excused reason",
          decided_by: "admin",
          decided_at: 100,
        },
      ],
      policy,
    );
    expect(calculateAttendance(sessions, shifts)).toEqual(before);
    expect(before.regularSeconds).toBe(9 * 3600);
  });
});
