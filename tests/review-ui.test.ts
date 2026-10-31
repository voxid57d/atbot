import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewTask } from "../shared/review-tasks";

const state = vi.hoisted(() => ({ payroll: null as any, discipline: null as any, fineBuild: null as ((f: FormData) => any) | null }));
vi.mock("../frontend/ui", async (original) => {
  const actual = await original<typeof import("../frontend/ui")>();
  const React = await import("react");
  return { ...actual,
    Form: (props: Parameters<typeof actual.Form>[0]) => {
      if (props.path === "/payroll/fines/decision") state.fineBuild = props.build;
      return React.createElement(actual.Form, props);
    },
    useResource: (path: string) => ({ data: path.startsWith("/payroll/") ? state.payroll
      : path.startsWith("/discipline/") ? state.discipline : path === "/attendance/people" ? { employees: [] } : {},
      error: "", loading: false, reload: async () => {} }),
  };
});
import { PayrollScreen } from "../frontend/payroll-ui";
import { Overview } from "../frontend/overview-ui";
import { DisciplineScreen } from "../frontend/discipline-ui";

beforeEach(() => {
  state.fineBuild = null;
  state.payroll = { disabledEmployeeIds: [], id: "period", period: { from: "2026-10-01", to: "2026-10-31" },
    status: "open", snapshotVersion: 0, revision: 1, warnings: [], totalPay: 100000, adjustments: [], payrollStartDay: 1,
    entries: [{ employeeId: "e", fullName: "Audit employee", role: "Assistant", level: "L1", actualSeconds: 3600,
      regularSeconds: 3600, overtimeSeconds: 0, paidSeconds: 3600, basePay: 100000, overtimePay: 0,
      workedGross: 100000, bonuses: 0, leavePay: 0, deductions: 0, advances: 0, fines: 0, finalPay: 100000,
      adjustments: [], rates: [], days: [], violations: [{ id: "v", work_date: "2026-10-16", category: "lateness",
        reason: "12 minute(s) late", ordinal: 2, status: "confirmed", proposedFine: 50000, progressionToken: "proposal-v1", fineDecision: null }] }],
  };
  state.discipline = { revision: 1, period: state.payroll.period, days: [], violations: [], tasks: [], early: [], fineDecisions: [],
    people: [{ id: "e", full_name: "Audit employee", active: 1 }], requests: [], openAttendance: [], history: [], locks: [],
    policy: { secondFine: 50000, thirdFine: 100000, fourthFine: 0, laterFine: 100000, laterAction: "Review" },
    policyId: 1, summary: {} };
});
const salary = () => renderToStaticMarkup(createElement(PayrollScreen, { canApprove: true, canAttendance: true, canRates: true }));
describe("Review pending/history rendering", () => {
  it.each(["approved", "rejected"])("keeps a completed %s fine in history without an active approval form", (status) => {
    state.payroll.entries[0].violations[0].fineDecision = { status, amount: status === "approved" ? 50000 : 0, reason: "Reviewed" };
    const html = salary();
    expect(html).toContain("Pending (0)");
    expect(html).toContain("History (1)");
    expect(html).toContain("Change decision");
    expect(html).not.toContain("Approve amount");
    expect(state.fineBuild).toBeNull();
  });
  it("wires rejection to zero regardless of the amount field and constrains approval to the proposal", () => {
    state.payroll.warnings = [reviewTask("e", "2026-10-16", "fine_approval", "Review fine", "v", "proposal-v1")];
    const html = salary();
    expect(html).toContain("Reject fine (zero)");
    expect(html).toContain('max="50000"');
    expect(html).toMatch(/<button[^>]*value="rejected"[^>]*name="decision"/);
    const f = new FormData();
    f.set("amount", "50000");
    f.set("decision", "rejected");
    expect(state.fineBuild!(f)).toMatchObject({ status: "rejected", amount: 0 });
    f.delete("decision");
    expect(state.fineBuild!(f)).toMatchObject({ status: "approved", amount: 50000 });
  });
  it("explains a blocked fine instead of offering a submit the backend will reject", () => {
    state.payroll.entries[0].violations[0].status = "detected";
    state.payroll.warnings = [reviewTask("e", "2026-10-16", "fine_approval", "Review fine", "v", "proposal-v1", "Confirm or excuse lateness first.")];
    expect(salary()).not.toContain("Approve amount");
    expect(salary()).toContain("Confirm or excuse lateness first.");
  });
  it("keeps superseded approval visible in history while the changed proposal needs a new decision", () => {
    state.payroll.fineDecisions = [{ violation_id: "v", employee_id: "e", work_date: "2026-10-16",
      progression_token: "old-proposal", status: "approved", amount: 20000, reason: "Earlier decision" }];
    state.payroll.warnings = [reviewTask("e", "2026-10-16", "fine_approval", "Review changed fine", "v", "proposal-v1")];
    const html = salary();
    expect(html).toContain("Pending (1)");
    expect(html).toContain("History (1)");
    expect(html).toContain("This decision is not applied.");
    expect(html).toContain("Approve amount");
  });
  it("renders the same unresolved decision count in the overview and inbox", () => {
    state.discipline.tasks = [reviewTask("e", "2026-10-16", "lateness_review", "Review lateness", "v")];
    state.discipline.violations = [{ ...state.payroll.entries[0].violations[0], employee_id: "e", source_token: "source",
      status: "detected", action: "Fine proposed", fineStatus: "proposed", fineReviewed: false, meetingRequired: false, meeting: null, decision: null }];
    const overview = renderToStaticMarkup(createElement(Overview, { user: {
      id: "root", telegramId: "1", fullName: "Audit", access: "super_admin", permissions: [],
    }, onNavigate: () => {} }));
    const inbox = renderToStaticMarkup(createElement(DisciplineScreen, { admin: true, canApprove: true }));
    expect(overview).toContain('Pending reviews</span><strong>1</strong>');
    expect(inbox).toContain('Pending decisions</small><strong>1</strong>');
    expect(inbox).toContain("Pending (1)");
  });
});
