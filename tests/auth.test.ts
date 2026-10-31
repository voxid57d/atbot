import { describe, it, expect } from "vitest";
import { signedLogin, testBotToken as token } from "./helpers";
import { verifyTelegram } from "../backend/auth";
import { can, localDate, type Identity } from "../shared/domain";
import { date, rateSchema, employeeSchema } from "../shared/validation";
describe("Telegram cryptographic verification", () => {
  it("verifies independently generated Telegram HMAC including signature field", async () => {
    const result = await verifyTelegram(
      signedLogin(100001, 1000, { signature: "signed-extra-field" }),
      token,
      1000,
    );
    expect(result.telegramId).toBe("100001");
  });
  it("rejects tampered user identity", async () => {
    const data = new URLSearchParams(signedLogin());
    data.set("user", JSON.stringify({ id: 99999 }));
    await expect(verifyTelegram(data.toString(), token)).rejects.toThrow();
  });
  it("rejects the wrong bot token", async () => {
    await expect(verifyTelegram(signedLogin(), "wrong")).rejects.toThrow();
  });
  it("rejects duplicate fields", async () => {
    await expect(
      verifyTelegram(signedLogin() + "&user=%7B%7D", token),
    ).rejects.toThrow();
  });
  it("accepts the last valid second", async () => {
    await expect(
      verifyTelegram(signedLogin(1, 1000), token, 1300),
    ).resolves.toMatchObject({ telegramId: "1" });
  });
  it("rejects expired initData", async () => {
    await expect(
      verifyTelegram(signedLogin(1, 1000), token, 1301),
    ).rejects.toThrow();
  });
  it("rejects future auth dates beyond clock tolerance", async () => {
    await expect(
      verifyTelegram(signedLogin(1, 1031), token, 1000),
    ).rejects.toThrow();
  });
  it("rejects malformed or missing hash", async () => {
    await expect(
      verifyTelegram("user={}&auth_date=1000&hash=bad", token, 1000),
    ).rejects.toThrow();
  });
  it("rejects unsafe Telegram IDs even with a valid signature", async () => {
    await expect(
      verifyTelegram(signedLogin(Number.MAX_SAFE_INTEGER + 1), token),
    ).rejects.toThrow();
  });
});
describe("shared foundation policies", () => {
  const user: Identity = {
    id: "employee",
    telegramId: "1",
    fullName: "Name",
    access: "employee",
    permissions: ["salary.manage"],
  };
  it("never grants employee access from a permission list", () => {
    expect(can(user, "salary.manage")).toBe(false);
  });
  it("keeps rate editing separate from payroll approval", () => {
    expect(can({ ...user, access: "admin" }, "salary.manage")).toBe(true);
    expect(can({ ...user, access: "admin" }, "payroll.approve")).toBe(false);
  });
  it("super administrators have full permissions", () => {
    expect(
      can({ ...user, access: "super_admin", permissions: [] }, "audit.view"),
    ).toBe(true);
  });
  it("uses the Tashkent date across UTC midnight boundaries", () => {
    expect(localDate(Date.parse("2026-10-09T20:00:00Z"))).toBe("2026-10-10");
  });
  it("rejects impossible dates", () => {
    expect(date.safeParse("2026-02-30").success).toBe(false);
  });
  it("rejects fractional currency values", () => {
    expect(
      rateSchema.safeParse({
        hourlyRate: 100.1,
        effectiveDate: "2026-10-10",
        reason: "Testing rate",
      }).success,
    ).toBe(false);
  });
  it("rejects frontend privilege injection", () => {
    expect(
      employeeSchema.safeParse({
        fullName: "Test",
        telegramId: "1",
        levelId: "test",
        activationDate: "2026-10-10",
        access: "super_admin",
      }).success,
    ).toBe(false);
  });
});
