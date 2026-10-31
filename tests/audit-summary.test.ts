import { describe, it, expect } from "vitest";
import { auditSummary } from "../frontend/audit-summary";
describe("Readable audit history", () => {
  it("does not describe an unchanged active account as reactivated", () => {
    const result = auditSummary({
      action: "employee.update",
      before_json: '{"full_name":"Amir","active":1}',
      after_json: '{"fullName":"Amir","active":true}',
    });
    expect(result).not.toContain("reactivated");
    expect(result).not.toContain("name changed");
  });
  it("uses recorded previous rates and preserves effective dates", () => {
    const result = auditSummary({
      action: "rate.create",
      entity_name: "Teacher",
      before_json: JSON.stringify({ hourly_rate: 12000 }),
      after_json: JSON.stringify({
        hourlyRate: 15000,
        effectiveDate: "2026-11-01",
      }),
    });
    expect(result).toContain("changed from");
    expect(result).toContain("Teacher");
    expect(result).toContain("1 Nov 2026");
    expect(result).not.toContain("hourly_rate");
  });
  it("does not invent previous amounts for older records", () => {
    expect(
      auditSummary({
        action: "rate.create",
        before_json: null,
        after_json: '{"hourlyRate":15000}',
      }),
    ).toContain("set to");
  });
  it("distinguishes a corrected negative uniform choice", () => {
    expect(
      auditSummary({
        action: "uniform.correct",
        before_json: null,
        after_json: '{"hasUniform":false}',
      }),
    ).toContain("corrected: no uniform");
  });
});
