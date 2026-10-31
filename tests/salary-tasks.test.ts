import { describe, it, expect } from "vitest";
import { salaryTaskPage, canReviewTask, finalizationBlockers } from "../frontend/salary-tasks";
describe("attendance correction task navigation", () => {
  it("opens attendance for closed invalid sessions instead of an empty request queue", () => {
    expect(salaryTaskPage("invalid_session")).toBe("attendance");
    expect(salaryTaskPage("open_attendance")).toBe("attendance");
    expect(salaryTaskPage("pending_request")).toBe("requests");
    expect(
      canReviewTask("invalid_session", {
        attendance: false,
        rates: true,
        approve: true,
      }),
    ).toBe(false);
  });
});


describe("Payroll finalization with work in progress", () => {
  it("blocks open sessions separately from the issue count", () => {
    expect(finalizationBlockers("2026-09-30", "2026-10-17", 0, 1, 1))
      .toEqual(["Attendance is still in progress. Close all sessions in this period before finalizing."]);
    expect(finalizationBlockers("2026-09-30", "2026-10-17", 0, 1, 0)).toEqual([]);
  });
});
