import { describe, it, expect } from "vitest";
import { shiftMessages } from "../shared/shift-messages";
import { dayStart } from "../shared/attendance";
const start = dayStart("2026-10-11") + 9 * 3600;
describe("friendly shift notification timing", () => {
  it("uses 30-minute start and 10-minute end reminders in Tashkent time", () => {
    const messages = shiftMessages(
      { id: "shift", start_at: start, end_at: start + 8 * 3600 },
      "Albina",
    );
    expect(messages[0].due).toBe(start - 1800);
    expect(messages[0].text).toContain("09:00");
    expect(messages[1].due).toBe(start + 8 * 3600 - 600);
    expect(messages[1].text).toContain("17:00");
    expect(messages[1].text).toContain("QR");
    expect(messages.filter((m) => m.kind === "encouragement")).toHaveLength(2);
  });
  it("sends one encouragement on a medium shift, none on short shifts, and stays away from reminders", () => {
    expect(
      shiftMessages(
        { id: "a", start_at: start, end_at: start + 3 * 3600 },
        "A",
      ).filter((m) => m.kind === "encouragement"),
    ).toHaveLength(1);
    expect(
      shiftMessages(
        { id: "a", start_at: start, end_at: start + 3600 },
        "A",
      ).filter((m) => m.kind === "encouragement"),
    ).toHaveLength(0);
    for (const message of shiftMessages(
      { id: "a", start_at: start, end_at: start + 6 * 3600 },
      "A",
    ).filter((m) => m.kind === "encouragement")) {
      expect(message.due).toBeGreaterThan(start + 1800);
      expect(message.expires).toBeLessThan(start + 6 * 3600 - 600);
    }
  });
});
