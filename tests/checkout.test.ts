import { describe, expect, it } from "vitest";
import { checkoutTiming } from "../shared/checkout";
import { dayStart, type Shift } from "../shared/attendance";

const start = dayStart("2026-10-16") + 22 * 3600;
const shift: Shift = { id: "night", start_at: start, end_at: start + 8 * 3600,
  kind: "regular", status: "scheduled", overtime_approved: 0, work_date: "2026-10-16" };
const session = { check_in: start, check_out: null, shift_id: shift.id };

describe("Checkout grace periods", () => {
  it("keeps a continuous split-shift visit working through the unpaid break and afternoon", () => {
    const day = dayStart("2026-10-16");
    const first = { ...shift, id: "morning", start_at: day + 8 * 3600, end_at: day + 10 * 3600 };
    const second = { ...shift, id: "afternoon", start_at: day + 14 * 3600, end_at: day + 18 * 3600 };
    const visit = { check_in: first.start_at, check_out: null, shift_id: first.id };
    for (const hour of [9, 11, 15, 17]) expect(checkoutTiming(visit, [second, first], [], day + hour * 3600))
      .toEqual({ expectedEnd: second.end_at, state: "working" });
    expect(checkoutTiming(visit, [first, second], [], second.end_at + 3600)?.state).toBe("review");
    expect(checkoutTiming(visit, [first, { ...second, status: "cancelled" }], [], day + 15 * 3600)?.state).toBe("review");
  });
  it("keeps a new check-in and an overnight shift working until its end", () => {
    for (const time of [start, start + 2 * 3600, shift.end_at - 1])
      expect(checkoutTiming(session, [shift], [], time)?.state).toBe("working");
  });
  it("advances at shift end, 30 minutes, and 60 minutes, then clears on checkout", () => {
    for (const [offset, state] of [[0, "reminder"], [1799, "reminder"], [1800, "overdue"], [3599, "overdue"], [3600, "review"]] as const)
      expect(checkoutTiming(session, [shift], [], shift.end_at + offset)?.state).toBe(state);
    expect(checkoutTiming({ ...session, check_out: shift.end_at }, [shift])).toBeNull();
  });
  it("extends through connected approved overtime but not a later separate shift", () => {
    const extra = { ...shift, id: "extra", kind: "extra" as const, overtime_approved: 1,
      start_at: shift.end_at, end_at: shift.end_at + 3600 };
    const later = { ...extra, id: "later", start_at: extra.end_at + 3600, end_at: extra.end_at + 7200 };
    expect(checkoutTiming(session, [shift, extra, later], [], shift.end_at + 1800))
      .toEqual({ expectedEnd: extra.end_at, state: "working" });
    expect(checkoutTiming(session, [shift], [{ start: shift.end_at, end: extra.end_at }], shift.end_at + 1800)?.state).toBe("working");
    expect(checkoutTiming(session, [shift, { ...extra, overtime_approved: 0 }], [], shift.end_at + 3600)?.state).toBe("review");
  });
  it("uses elapsed time for unscheduled sessions, including across midnight", () => {
    const unscheduled = { ...session, shift_id: null };
    expect(checkoutTiming(unscheduled, [], [], start + 2 * 3600)?.state).toBe("working");
    expect(checkoutTiming(unscheduled, [], [], start + 18 * 3600)?.state).toBe("reminder");
    expect(checkoutTiming(unscheduled, [], [], start + 19 * 3600)?.state).toBe("review");
  });
});
