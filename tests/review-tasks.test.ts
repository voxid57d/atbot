import { describe, it, expect } from "vitest";
import { disciplineReviewTasks, reviewTask } from "../shared/review-tasks";
import { canReviewTask } from "../frontend/salary-tasks";

const period = { from: "2026-10-01", to: "2026-10-31" };
const violation = { id: "late:shift", employee_id: "employee", work_date: "2026-10-16", status: "detected",
  ordinal: 2, proposedFine: 50000, fineReviewed: false, progressionToken: "source-v1", meetingRequired: false, meeting: null };
const build = (change: Partial<Parameters<typeof disciplineReviewTasks>[0]> = {}) => disciplineReviewTasks({
  period, locks: [], days: [], violations: [violation], early: [], requests: [], checkouts: [], ...change,
});
describe("Shared review inbox tasks", () => {
  it("counts detected lateness and marks its financial decision as waiting", () => {
    const tasks = build();
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.kind === "lateness_review")?.state).toBe("pending");
    const fine = tasks.find((t) => t.kind === "fine_approval")!;
    expect(fine.state).toBe("blocked");
    expect(canReviewTask(fine, { attendance: true, rates: true, approve: true })).toBe(false);
  });
  it("removes saved fine decisions from pending, including rejected decisions", () => {
    expect(build({ violations: [{ ...violation, status: "confirmed", fineReviewed: true }] })).toEqual([]);
    expect(build({ violations: [{ ...violation, status: "confirmed" }] })[0]).toMatchObject({ kind: "fine_approval", state: "pending", sourceVersion: "source-v1" });
  });
  it("routes fine configuration to its actual owner", () => {
    const task = build({ violations: [{ ...violation, status: "confirmed", proposedFine: null }] })[0];
    expect(task.requiredPermission).toBe("super_admin");
    expect(canReviewTask(task, { attendance: true, rates: true, approve: true })).toBe(false);
    expect(canReviewTask(task, { attendance: true, rates: true, approve: true, superAdmin: true })).toBe(true);
  });
  it("uses the shared grace status and scopes tasks to the selected unlocked month", () => {
    const checkouts = [
      { id: "working", employee_id: "employee", work_date: "2026-10-16", state: "working" as const, expectedEnd: 1 },
      { id: "due", employee_id: "employee", work_date: "2026-10-16", state: "review" as const, expectedEnd: 2 },
      { id: "old", employee_id: "employee", work_date: "2026-09-30", state: "review" as const, expectedEnd: 3 },
    ];
    expect(build({ violations: [], checkouts }).map((t) => t.subjectId)).toEqual(["due"]);
    expect(build({ checkouts, locks: [{ from_date: period.from, to_date: period.to }] })).toEqual([]);
  });
  it("defers quality while work continues without inventing a forgotten checkout", () => {
    const tasks = build({ violations: [], days: [{ employee_id: "employee", work_date: "2026-10-16",
      qualityPending: true, attendance_snapshot: "open", inProgress: true, open_sessions: 1, uniform: { status: "approved" } }] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "quality_review", state: "blocked" });
    expect(tasks[0].blockedBy).toContain("Work is in progress");
  });
  it("distinguishes multiple decisions on the same workday", () => {
    expect(reviewTask("e", "2026-10-16", "pending_request", "Review", "a").id)
      .not.toBe(reviewTask("e", "2026-10-16", "pending_request", "Review", "b").id);
  });
});
