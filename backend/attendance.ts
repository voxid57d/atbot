import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./types";
import {
  body,
  now,
  requirePermission,
  superAdmin,
  type AppContext,
} from "./http";
import { audit, mutate, currentOrFuture, replayMutation } from "./data";
import { sha256 } from "./auth";
import { notify, notifyAdminCheckIn } from "./notifications";
import { dailyEarnings, additionalPaidSeconds } from "../shared/payroll";
import { openCheckoutTimings } from "./checkout";
import { automaticCheckout } from "./automatic-checkout";
import { verifyQR } from "./qr";
import { getShiftsRange } from "./schedules";
import { localDate } from "../shared/domain";
import { date, name, reason } from "../shared/validation";
import {
  calculateAttendance,
  dayStart,
  dateRange,
  roundUZS,
  payrollRange,
  type Session,
  type Rate,
  type Shift,
} from "../shared/attendance";
const employeeId = z.string().min(1).max(100),
  minute = z.number().int().min(0).max(1439);
const hours = { startMinute: minute, endMinute: minute };
const secondHours = {
  secondStartMinute: minute.nullable().optional().default(null),
  secondEndMinute: minute.nullable().optional().default(null),
};
const validSecondShift = (v: { endMinute: number; secondStartMinute: number | null; secondEndMinute: number | null }) =>
  (v.secondStartMinute === null && v.secondEndMinute === null) ||
  (v.secondStartMinute !== null && v.secondEndMinute !== null &&
    v.secondStartMinute >= v.endMinute && v.secondEndMinute > v.secondStartMinute);
const weeklySchema = z
  .object({
    employeeId,
    weekday: z.number().int().min(0).max(6),
    ...hours,
    ...secondHours,
    effectiveDate: date,
    active: z.boolean().default(true),
    reason,
  })
  .strict()
  .refine(
    (v) => v.endMinute > v.startMinute,
    "Shifts must finish later the same day",
  )
  .refine(validSecondShift, "The second shift must start after the first shift ends and finish later the same day");
const overrideSchema = z
  .object({
    employeeId,
    date,
    ...hours,
    ...secondHours,
    cancelled: z.boolean().default(false),
    reason,
  })
  .strict()
  .refine(
    (v) => v.cancelled || v.endMinute > v.startMinute,
    "Shifts must finish later the same day",
  )
  .refine(validSecondShift, "The second shift must start after the first shift ends and finish later the same day");
const extraSchema = z
  .object({ employeeId, date, ...hours, approved: z.boolean(), reason })
  .strict()
  .refine(
    (v) => v.endMinute > v.startMinute,
    "Shifts must finish later the same day",
  );
const scheduleEditSchema = z
  .object({
    ...hours,
    revision: z.number().int().nonnegative(),
    reason,
    cancelled: z.boolean().default(false),
    approved: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => v.cancelled || v.endMinute > v.startMinute,
    "Shifts must finish later the same day",
  );
function scheduleRevisionGuard(c: AppContext, revision: number) {
  return c.env.DB.prepare(
    "UPDATE discipline_state SET revision=? WHERE id=1",
  ).bind(revision + 1);
}
async function ownEmployee(c: AppContext) {
  const e = await c.env.DB.prepare(
    "SELECT e.* FROM employees e JOIN users u ON u.id=e.user_id WHERE e.user_id=? AND u.active=1 AND e.activation_date<=? AND (e.deactivation_date IS NULL OR e.deactivation_date>?)",
  )
    .bind(c.get("identity").id, localDate(), localDate())
    .first<{ id: string }>();
  if (!e)
    throw new HTTPException(403, {
      message: "An active employee profile is required for attendance.",
    });
  return e;
}
async function employeeExists(c: AppContext, id: string) {
  if (
    !(await c.env.DB.prepare("SELECT id FROM employees WHERE id=?")
      .bind(id)
      .first())
  )
    throw new HTTPException(404, { message: "Employee not found." });
}
async function unchangedDay(c: AppContext, id: string, workDate: string) {
  if (
    await c.env.DB.prepare(
      "SELECT id FROM effective_attendance WHERE employee_id=? AND work_date>=? LIMIT 1",
    )
      .bind(id, workDate)
      .first()
  )
    throw new HTTPException(409, {
      message:
        "Attendance already exists on or after this effective date. Choose a later date; historical schedule changes need a correction workflow.",
    });
}
export const attendanceRoutes = new Hono<AppEnv>();
attendanceRoutes.post("/schedules/weekly/:id/edit", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        ...hours,
        ...secondHours,
        effectiveDate: date,
        active: z.boolean(),
        revision: z.number().int().nonnegative(),
        reason,
      })
      .strict()
      .refine(
        (v) => v.endMinute > v.startMinute,
        "Shifts must finish later the same day",
      )
      .refine(validSecondShift, "The second shift must start after the first shift ends and finish later the same day"),
  );
  const before = await c.env.DB.prepare(
    "SELECT * FROM weekly_schedules WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      employee_id: string;
      weekday: number;
      effective_date: string;
    }>();
  if (!before)
    throw new HTTPException(404, { message: "Weekly schedule not found." });
  currentOrFuture(i.effectiveDate);
  if (i.effectiveDate < before.effective_date)
    throw new HTTPException(400, {
      message: "Choose the existing effective date or a later date.",
    });
  await unchangedDay(c, before.employee_id, i.effectiveDate);
  if (
    await c.env.DB.prepare(
      "SELECT from_date FROM payroll_period_locks WHERE to_date>=? LIMIT 1",
    )
      .bind(i.effectiveDate)
      .first()
  )
    throw new HTTPException(409, {
      message:
        "This weekly change affects a locked payroll period. Choose a later effective date.",
    });
  const replace = i.effectiveDate === before.effective_date;
  const statement = replace
    ? c.env.DB.prepare(
        "UPDATE weekly_schedules SET start_minute=?,end_minute=?,second_start_minute=?,second_end_minute=?,active=?,created_by=?,created_at=? WHERE id=?",
      ).bind(
        i.startMinute,
        i.endMinute,
        i.secondStartMinute,
        i.secondEndMinute,
        i.active ? 1 : 0,
        c.get("identity").id,
        now(),
        before.id,
      )
    : c.env.DB.prepare(
        "INSERT INTO weekly_schedules(id,employee_id,weekday,start_minute,end_minute,second_start_minute,second_end_minute,effective_date,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        before.employee_id,
        before.weekday,
        i.startMinute,
        i.endMinute,
        i.secondStartMinute,
        i.secondEndMinute,
        i.effectiveDate,
        i.active ? 1 : 0,
        c.get("identity").id,
        now(),
      );
  return mutate(
    c,
    [
      scheduleRevisionGuard(c, i.revision),
      statement,
      audit(c, "schedule.weekly.edit", before.id, before, i, i.reason),
    ],
    { ok: true },
  );
});
attendanceRoutes.post("/schedules/shifts/:id/edit", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, scheduleEditSchema);
  const before = await c.env.DB.prepare(
    "SELECT * FROM scheduled_shifts WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      employee_id: string;
      work_date: string;
      kind: string;
      slot: number;
    }>();
  if (!before) throw new HTTPException(404, { message: "Shift not found." });
  if (
    before.kind === "extra" &&
    (await c.env.DB.prepare(
      "SELECT id FROM shift_coverage_assignments WHERE id=(SELECT source_id FROM scheduled_shifts WHERE id=?)",
    )
      .bind(before.id)
      .first())
  )
    throw new HTTPException(409, {
      message:
        "This shift belongs to accepted coverage and cannot be changed through the schedule editor.",
    });
  if (
    await c.env.DB.prepare(
      "SELECT from_date FROM payroll_period_locks WHERE ? BETWEEN from_date AND to_date LIMIT 1",
    )
      .bind(before.work_date)
      .first()
  )
    throw new HTTPException(409, {
      message:
        "This day is locked by payroll. Reopen the period before changing it.",
    });
  const correctionId = crypto.randomUUID();
  const after = {
    ...before,
    start_at: dayStart(before.work_date) + i.startMinute * 60,
    end_at: dayStart(before.work_date) + i.endMinute * 60,
    status: i.cancelled ? "cancelled" : "scheduled",
    overtime_approved: before.kind === "extra" && i.approved ? 1 : 0,
  };
  const writes = [
    scheduleRevisionGuard(c, i.revision),
    c.env.DB.prepare(
      "INSERT INTO schedule_corrections(id,shift_id,employee_id,work_date,before_json,after_json,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      correctionId,
      before.id,
      before.employee_id,
      before.work_date,
      JSON.stringify(before),
      JSON.stringify(after),
      c.get("identity").id,
      i.reason,
      now(),
    ),
    c.env.DB.prepare(
      "INSERT INTO schedule_correction_context(shift_id,correction_id) VALUES(?,?)",
    ).bind(before.id, correctionId),
  ];
  if (before.kind === "regular") {
    const siblings = (await c.env.DB.prepare("SELECT * FROM scheduled_shifts WHERE employee_id=? AND work_date=? AND kind='regular'")
      .bind(before.employee_id, before.work_date).all<Shift>()).results;
    const primary = before.slot === 2 ? siblings.find((s) => s.slot === 1)! : after;
    const secondary = before.slot === 2 ? after : siblings.find((s) => s.slot === 2);
    if (primary.status === "scheduled" && secondary?.status === "scheduled" && primary.end_at > secondary.start_at)
      throw new HTTPException(400, { message: "The second shift must start after the first shift ends." });
    writes.push(
      c.env.DB.prepare(
        "INSERT INTO shift_overrides(id,employee_id,work_date,start_minute,end_minute,cancelled,second_start_minute,second_end_minute,second_cancelled,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET start_minute=excluded.start_minute,end_minute=excluded.end_minute,cancelled=excluded.cancelled,second_start_minute=excluded.second_start_minute,second_end_minute=excluded.second_end_minute,second_cancelled=excluded.second_cancelled,reason=excluded.reason,created_by=excluded.created_by,created_at=excluded.created_at",
      ).bind(
        crypto.randomUUID(),
        before.employee_id,
        before.work_date,
        (primary.start_at - dayStart(before.work_date)) / 60,
        (primary.end_at - dayStart(before.work_date)) / 60,
        primary.status === "cancelled" ? 1 : 0,
        secondary ? (secondary.start_at - dayStart(before.work_date)) / 60 : null,
        secondary ? (secondary.end_at - dayStart(before.work_date)) / 60 : null,
        secondary?.status === "cancelled" ? 1 : 0,
        i.reason,
        c.get("identity").id,
        now(),
      ),
    );
  }
  writes.push(
    c.env.DB.prepare(
      "UPDATE scheduled_shifts SET start_at=?,end_at=?,status=?,overtime_approved=? WHERE id=?",
    ).bind(
      dayStart(before.work_date) + i.startMinute * 60,
      dayStart(before.work_date) + i.endMinute * 60,
      i.cancelled ? "cancelled" : "scheduled",
      before.kind === "extra" && i.approved ? 1 : 0,
      before.id,
    ),
    c.env.DB.prepare(
      "DELETE FROM schedule_correction_context WHERE shift_id=?",
    ).bind(before.id),
    audit(c, "schedule.shift.edit", before.id, before, after, i.reason),
  );
  return mutate(c, writes, { ok: true });
});
attendanceRoutes.post("/schedules/weekly", async (c) => {
  requirePermission(c, "attendance.manage");
  const i = await body(c, weeklySchema);
  currentOrFuture(i.effectiveDate);
  await employeeExists(c, i.employeeId);
  await unchangedDay(c, i.employeeId, i.effectiveDate);
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO weekly_schedules(id,employee_id,weekday,start_minute,end_minute,second_start_minute,second_end_minute,effective_date,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        i.employeeId,
        i.weekday,
        i.startMinute,
        i.endMinute,
        i.secondStartMinute,
        i.secondEndMinute,
        i.effectiveDate,
        i.active ? 1 : 0,
        c.get("identity").id,
        now(),
      ),
      audit(c, "schedule.weekly.create", i.employeeId, null, i, i.reason),
    ],
    { ok: true },
    201,
  );
});
attendanceRoutes.post("/schedules/override", async (c) => {
  requirePermission(c, "attendance.manage");
  const i = await body(c, overrideSchema);
  currentOrFuture(i.date);
  await employeeExists(c, i.employeeId);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM effective_attendance WHERE employee_id=? AND work_date=? LIMIT 1",
    )
      .bind(i.employeeId, i.date)
      .first()
  )
    throw new HTTPException(409, {
      message:
        "This workday already has attendance. Its schedule snapshot cannot be rewritten.",
    });
  const before = await c.env.DB.prepare(
    "SELECT * FROM shift_overrides WHERE employee_id=? AND work_date=?",
  )
    .bind(i.employeeId, i.date)
    .first();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO shift_overrides(id,employee_id,work_date,start_minute,end_minute,cancelled,second_start_minute,second_end_minute,second_cancelled,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET start_minute=excluded.start_minute,end_minute=excluded.end_minute,cancelled=excluded.cancelled,second_start_minute=excluded.second_start_minute,second_end_minute=excluded.second_end_minute,second_cancelled=excluded.second_cancelled,reason=excluded.reason,created_by=excluded.created_by,created_at=excluded.created_at",
      ).bind(
        crypto.randomUUID(),
        i.employeeId,
        i.date,
        i.startMinute,
        i.endMinute,
        i.cancelled ? 1 : 0,
        i.secondStartMinute,
        i.secondEndMinute,
        i.cancelled ? 1 : 0,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "schedule.override", i.employeeId, before, i, i.reason),
    ],
    { ok: true },
  );
});
attendanceRoutes.post("/schedules/extra", async (c) => {
  requirePermission(c, "attendance.manage");
  const i = await body(c, extraSchema);
  currentOrFuture(i.date);
  await employeeExists(c, i.employeeId);
  const id = crypto.randomUUID();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,overtime_approved,created_by,created_at) VALUES(?,?,?,?,?,'extra','scheduled',?,?,?)",
      ).bind(
        id,
        i.employeeId,
        i.date,
        dayStart(i.date) + i.startMinute * 60,
        dayStart(i.date) + i.endMinute * 60,
        i.approved ? 1 : 0,
        c.get("identity").id,
        now(),
      ),
      audit(c, "schedule.extra.create", id, null, i, i.reason),
    ],
    { id },
    201,
  );
});
// Whole-team week for the Schedules page when no single employee is selected.
attendanceRoutes.get("/schedules/team", async (c) => {
  requirePermission(c, "attendance.manage");
  const from = date.parse(c.req.query("from") ?? localDate()),
    to = date.parse(c.req.query("to") ?? from);
  if (to < from || (dayStart(to) - dayStart(from)) / 86400 >= 7)
    throw new HTTPException(400, { message: "Choose a range of up to 7 days." });
  const shifts = await getShiftsRange(c.env.DB, null, from, to);
  const people = (
    await c.env.DB.prepare(
      "SELECT e.id,u.full_name,u.active FROM employees e JOIN users u ON u.id=e.user_id WHERE e.activation_date<=? AND (e.deactivation_date IS NULL OR e.deactivation_date>?) ORDER BY u.full_name",
    )
      .bind(to, from)
      .all()
  ).results;
  return c.json({ people, shifts });
});
attendanceRoutes.get("/schedules", async (c) => {
  requirePermission(c, "attendance.manage");
  const id = employeeId.parse(c.req.query("employeeId")),
    from = date.parse(c.req.query("from") ?? localDate()),
    to = date.parse(c.req.query("to") ?? from);
  if (to < from || (dayStart(to) - dayStart(from)) / 86400 >= 31)
    throw new HTTPException(400, {
      message: "Choose a range of up to 31 days.",
    });
  await employeeExists(c, id);
  await getShiftsRange(c.env.DB, id, from, to);
  const snapshot = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT * FROM scheduled_shifts WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date,start_at,id",
    ).bind(id, from, to),
    c.env.DB.prepare(
      "SELECT * FROM weekly_schedules WHERE employee_id=? ORDER BY effective_date DESC,weekday",
    ).bind(id),
    c.env.DB.prepare("SELECT revision FROM discipline_state WHERE id=1"),
    c.env.DB.prepare(
      "SELECT work_date,status,paid,payload_json FROM employee_requests WHERE employee_id=? AND kind='absence' AND status='approved' AND work_date BETWEEN ? AND ?",
    ).bind(id, from, to),
    c.env.DB.prepare(
      "SELECT work_date,start_at,end_at,status FROM shift_coverage_assignments WHERE employee_id=? AND work_date BETWEEN ? AND ? AND status!='declined'",
    ).bind(id, from, to),
    c.env.DB.prepare(
      "SELECT * FROM effective_attendance WHERE employee_id=? AND work_date BETWEEN ? AND ?",
    ).bind(id, from, to),
    c.env.DB.prepare(
      "SELECT from_date,to_date FROM payroll_period_locks WHERE from_date<=? AND to_date>=?",
    ).bind(to, from),
    c.env.DB.prepare(
      "SELECT h.*,u.full_name AS actor_name FROM schedule_corrections h JOIN users u ON u.id=h.actor_id WHERE h.employee_id=? AND h.work_date BETWEEN ? AND ? ORDER BY h.created_at DESC,h.id DESC",
    ).bind(id, from, to),
  ]);
  return c.json({
    shifts: snapshot[0].results,
    weekly: snapshot[1].results,
    absences: snapshot[3].results,
    coverage: snapshot[4].results,
    sessions: snapshot[5].results,
    locks: snapshot[6].results,
    corrections: snapshot[7].results,
    revision: Number((snapshot[2].results[0] as { revision: number }).revision),
  });
});
attendanceRoutes.get("/attendance/people", async (c) => {
  requirePermission(c, "attendance.manage");
  return c.json({
    employees: (
      await c.env.DB.prepare(
        "SELECT e.id,u.full_name,u.active FROM employees e JOIN users u ON u.id=e.user_id ORDER BY u.full_name",
      ).all()
    ).results,
  });
});
attendanceRoutes.get("/tablets", async (c) => {
  superAdmin(c);
  return c.json({
    tablets: (
      await c.env.DB.prepare(
        "SELECT id,name,created_at,pairing_expires_at,credential_expires_at,revoked_at,CASE WHEN credential_hash IS NOT NULL THEN 1 ELSE 0 END AS paired FROM registered_tablets ORDER BY created_at DESC,id",
      ).all()
    ).results,
  });
});
attendanceRoutes.post("/tablets", async (c) => {
  superAdmin(c);
  const i = await body(
      c,
      z
        .object({ name, pairingCode: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict(),
    ),
    id = crypto.randomUUID();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO registered_tablets(id,name,pairing_hash,pairing_expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        id,
        i.name,
        await sha256(i.pairingCode),
        now() + 300,
        c.get("identity").id,
        now(),
      ),
      audit(c, "tablet.register", id, null, { name: i.name }),
    ],
    { id },
    201,
  );
});
attendanceRoutes.post("/tablets/:id/revoke", async (c) => {
  superAdmin(c);
  const i = await body(c, z.object({ reason }).strict()),
    id = c.req.param("id");
  if (
    !(await c.env.DB.prepare("SELECT id FROM registered_tablets WHERE id=?")
      .bind(id)
      .first())
  )
    throw new HTTPException(404, { message: "Display not found." });
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "UPDATE registered_tablets SET revoked_at=?,pairing_hash=NULL,credential_hash=NULL WHERE id=?",
      ).bind(now(), id),
      audit(c, "tablet.revoke", id, null, { revoked: true }, i.reason),
    ],
    { ok: true },
  );
});
attendanceRoutes.post("/attendance/check-in", async (c) => {
  const employee = await ownEmployee(c),
    replay = await replayMutation(c);
  if (replay) return replay;
  const { qr } = await body(c, z.object({ qr: z.string().max(600) }).strict()),
    payload = await verifyQR(qr, c.env.TELEGRAM_BOT_TOKEN);
  const tablet = await c.env.DB.prepare(
    "SELECT id FROM registered_tablets WHERE id=? AND credential_hash IS NOT NULL AND (credential_expires_at IS NULL OR credential_expires_at>?) AND revoked_at IS NULL",
  )
    .bind(payload.d, now())
    .first();
  if (!tablet)
    throw new HTTPException(400, {
      message: "This reception display is no longer registered.",
    });
  await automaticCheckout(c.env.DB);
  if (now() >= dayStart(localDate()) + 23 * 3600)
    throw new HTTPException(400, { message: "Daily attendance closes at 23:00 Tashkent time. Check in again tomorrow." });
  if (
    await c.env.DB.prepare(
      "SELECT id FROM attendance_sessions WHERE employee_id=? AND check_out IS NULL",
    )
      .bind(employee.id)
      .first()
  ) {
    const replay = await replayMutation(c);
    if (replay) return replay;
    throw new HTTPException(409, {
      message:
        "You already have an active session. Check out before returning.",
    });
  }
  const workDate = localDate(),
    time = now(),
    shifts = await getShiftsRange(c.env.DB, employee.id, workDate, workDate),
    shift =
      shifts.find(
        (s) =>
          s.kind === "regular" && s.status === "scheduled" && time < s.end_at,
      ) ??
      shifts.find(
        (s) =>
          s.kind === "extra" &&
          s.status === "scheduled" &&
          time >= s.start_at &&
          time < s.end_at,
      ),
    id = crypto.randomUUID();
  // Verify expiry again after schedule materialization, immediately before the atomic write.
  await verifyQR(qr, c.env.TELEGRAM_BOT_TOKEN, now());
  const checkIn = now();
  const tashkentClock = (seconds: number) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(seconds * 1000);
  const adminMessage = `✅ Employee checked in\n👤 ${c.get("identity").fullName}\n📅 ${workDate}\n🕒 ${tashkentClock(checkIn)} (Tashkent)\n${shift ? `📋 Shift: ${tashkentClock(shift.start_at)} – ${tashkentClock(shift.end_at)}` : "📋 No assigned shift"}\n\nOpen Live attendance: ${c.env.APP_ORIGIN}`;
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO attendance_sessions(id,employee_id,shift_id,work_date,check_in,tablet_id,created_at) VALUES(?,?,?,?,CASE WHEN unixepoch()<? AND unixepoch()<unixepoch(? || 'T23:00:00+05:00') THEN ? ELSE NULL END,?,?)",
      ).bind(
        id,
        employee.id,
        shift?.id ?? null,
        workDate,
        payload.e,
        workDate,
        checkIn,
        payload.d,
        checkIn,
      ),
      notify(
        c.env.DB,
        `check-in:${id}`,
        "You're checked in! ✅ Welcome to your workday at IELTS ZONE 💜 Open your workspace to confirm your uniform choice.",
        employee.id,
      ),
      audit(c, "attendance.check_in", id, null, {
        employeeId: employee.id,
        checkIn,
        shiftId: shift?.id ?? null,
      }),
      notifyAdminCheckIn(c.env.DB, id, adminMessage),
    ],
    { id, checkIn },
    201,
  );
});
attendanceRoutes.post("/attendance/check-out", async (c) => {
  const e = await ownEmployee(c),
    replay = await replayMutation(c);
  if (replay) return replay;
  const { qr } = await body(c, z.object({ qr: z.string().max(600) }).strict());
  const payload = await verifyQR(qr, c.env.TELEGRAM_BOT_TOKEN);
  const display = await c.env.DB.prepare(
    "SELECT id FROM registered_tablets WHERE id=? AND credential_hash IS NOT NULL AND (credential_expires_at IS NULL OR credential_expires_at>?) AND revoked_at IS NULL",
  )
    .bind(payload.d, now())
    .first();
  if (!display)
    throw new HTTPException(400, {
      message: "This reception display is no longer registered.",
    });
  const session = await c.env.DB.prepare(
    "SELECT * FROM attendance_sessions WHERE employee_id=? AND check_out IS NULL",
  )
    .bind(e.id)
    .first<Session & { id: string }>();
  if (!session) {
    const replay = await replayMutation(c);
    if (replay) return replay;
    throw new HTTPException(409, {
      message: "There is no active session to check out.",
    });
  }
  const checkout = Math.max(now(), session.check_in);
  // A unique transition marker in the same batch makes concurrent distinct-key closes roll back.
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO attendance_closures(session_id,closed_at) VALUES(?,CASE WHEN unixepoch()<? AND EXISTS(SELECT 1 FROM registered_tablets WHERE id=? AND credential_hash IS NOT NULL AND (credential_expires_at IS NULL OR credential_expires_at>unixepoch()) AND revoked_at IS NULL) THEN ? ELSE NULL END)",
      ).bind(session.id, payload.e, payload.d, checkout),
      c.env.DB.prepare(
        "UPDATE attendance_sessions SET check_out=?,checkout_source='employee',closed_by=? WHERE id=? AND check_out IS NULL",
      ).bind(checkout, c.get("identity").id, session.id),
      audit(c, "attendance.check_out", session.id, session, { checkout }),
      notify(
        c.env.DB,
        `check-out:${session.id}`,
        "You're checked out! 🙌 Thanks for your work today. Enjoy your time off 💜 Your attendance details are in the workspace.",
        e.id,
      ),
      notify(
        c.env.DB,
        `admin-check-out:${session.id}`,
        `👋 Employee checked out\n👤 ${c.get("identity").fullName}\n📅 ${localDate(checkout * 1000)}\n🕒 ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(checkout * 1000)} (Tashkent)\n⏱️ This visit: ${Math.floor((checkout - session.check_in) / 3600)}h ${Math.floor(((checkout - session.check_in) % 3600) / 60)}m\n\nOpen Live attendance: ${c.env.APP_ORIGIN}`,
        undefined,
        true,
      ),
    ],
    {
      id: session.id,
      checkOut: checkout,
      actualSeconds: checkout - session.check_in,
    },
  );
});
attendanceRoutes.post("/attendance/:id/close", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
      c,
      z.object({ checkout: z.number().int().positive(), reason }).strict(),
    ),
    id = c.req.param("id");
  const session = await c.env.DB.prepare(
    "SELECT * FROM attendance_sessions WHERE id=? AND check_out IS NULL",
  )
    .bind(id)
    .first<Session>();
  if (!session) {
    const replay = await replayMutation(c);
    if (replay) return replay;
    throw new HTTPException(409, { message: "This session is not open." });
  }
  if (i.checkout < session.check_in || i.checkout > now())
    throw new HTTPException(400, {
      message: "Checkout must be between check-in and server time.",
    });
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO attendance_closures(session_id,closed_at) VALUES(?,?)",
      ).bind(id, i.checkout),
      c.env.DB.prepare(
        "UPDATE attendance_sessions SET check_out=?,checkout_source='admin',checkout_reason=?,closed_by=? WHERE id=? AND check_out IS NULL",
      ).bind(i.checkout, i.reason, c.get("identity").id, id),
      audit(c, "attendance.admin_close", id, session, i, i.reason),
    ],
    { ok: true },
  );
});
attendanceRoutes.post("/attendance/overtime", async (c) => {
  requirePermission(c, "attendance.manage");
  const i = await body(
    c,
    z
      .object({
        employeeId,
        date,
        start: z.number().int().positive(),
        end: z.number().int().positive(),
        reason,
      })
      .strict(),
  );
  await employeeExists(c, i.employeeId);
  if (
    i.end <= i.start ||
    i.start < dayStart(i.date) ||
    i.end > dayStart(i.date) + 86400
  )
    throw new HTTPException(400, {
      message: "Choose a valid overtime interval within the workday.",
    });
  const id = crypto.randomUUID();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO overtime_approvals(id,employee_id,work_date,start_at,end_at,reason,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        i.employeeId,
        i.date,
        i.start,
        i.end,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "overtime.approve", id, null, i, i.reason),
    ],
    { id },
    201,
  );
});
export async function historicalRates(
  c: AppContext,
  id: string,
  to: string,
): Promise<Rate[]> {
  const [assignments, rates, policies] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT h.level_id,h.effective_date,l.role_id FROM employee_role_history h JOIN role_levels l ON l.id=h.level_id WHERE employee_id=? AND effective_date<=? ORDER BY effective_date",
    ).bind(id, to),
    c.env.DB.prepare(
      "SELECT level_id,effective_date,hourly_rate FROM hourly_rate_history WHERE level_id IN (SELECT level_id FROM employee_role_history WHERE employee_id=?) AND effective_date<=? ORDER BY effective_date",
    ).bind(id, to),
    c.env.DB.prepare(
      "SELECT * FROM role_daily_pay_history WHERE role_id IN (SELECT l.role_id FROM employee_role_history h JOIN role_levels l ON l.id=h.level_id WHERE h.employee_id=?) AND effective_date<=? ORDER BY effective_date,id",
    ).bind(id, to),
  ]);
  const a = assignments.results as unknown as {
      level_id: string;
      role_id: string;
      effective_date: string;
    }[],
    r = rates.results as unknown as {
      level_id: string;
      effective_date: string;
      hourly_rate: number;
    }[],
    policiesRows = policies.results as unknown as {
      role_id: string;
      enabled: number;
      threshold_minutes: number;
      hourly_rate: number;
      effective_date: string;
    }[],
    boundaries = [
      ...new Set([...a, ...r, ...policiesRows].map((v) => v.effective_date)),
    ].sort();
  const out: Rate[] = [];
  for (const date of boundaries) {
    const assignment = a.filter((v) => v.effective_date <= date).at(-1);
    if (!assignment) continue;
    const rate = r
      .filter(
        (v) => v.level_id === assignment.level_id && v.effective_date <= date,
      )
      .at(-1);
    const policy = policiesRows
      .filter(
        (v) => v.role_id === assignment.role_id && v.effective_date <= date,
      )
      .at(-1);
    out.push({
      effective: dayStart(date),
      hourlyRate: rate?.hourly_rate ?? null,
      dailyRule: policy?.enabled
        ? {
            thresholdMinutes: policy.threshold_minutes,
            hourlyRate: policy.hourly_rate,
          }
        : null,
    });
  }
  return out;
}
attendanceRoutes.get("/attendance/mine", async (c) => {
  const e = await ownEmployee(c),
    today = localDate(),
    settings = await c.env.DB.prepare(
      "SELECT payroll_start_day FROM system_settings WHERE id=1",
    ).first<{ payroll_start_day: number }>(),
    period = payrollRange(
      date.parse(c.req.query("periodDate") ?? today),
      settings!.payroll_start_day,
    ),
    rates = await historicalRates(c, e.id, period.to),
    shifts = await getShiftsRange(c.env.DB, e.id, period.from, period.to);
  const sessions = (
    await c.env.DB.prepare(
      "SELECT a.*,EXISTS(SELECT 1 FROM attendance_originals o WHERE o.session_id=a.id) AS corrected,EXISTS(SELECT 1 FROM automatic_checkouts x WHERE x.session_id=a.id) AS automatically_closed FROM effective_attendance a WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY check_in,id",
    )
      .bind(e.id, period.from, period.to)
      .all<Session & { id: string; work_date: string }>()
  ).results;
  const approvals = (
    await c.env.DB.prepare(
      "SELECT start_at,end_at,work_date FROM overtime_approvals WHERE employee_id=? AND work_date BETWEEN ? AND ?",
    )
      .bind(e.id, period.from, period.to)
      .all<{ start_at: number; end_at: number; work_date: string }>()
  ).results;
  const days = dateRange(period.from, period.to).map((date) => {
    const dayShifts = shifts.filter((s) => s.work_date === date),
      daySessions = sessions.filter((s) => s.work_date === date),
      calc = calculateAttendance(
        daySessions,
        dayShifts,
        approvals
          .filter((o) => o.work_date === date)
          .map((o) => ({ start: o.start_at, end: o.end_at })),
      );
    const {
      regular,
      overtime,
      thresholdSeconds,
      paidSeconds,
      discardedSeconds,
    } = dailyEarnings(calc.regularIntervals, calc.overtimeIntervals, rates);
    return {
      date,
      shifts: dayShifts,
      sessions: daySessions,
      ...calc,
      pendingPaidSeconds: additionalPaidSeconds(
        calc.regularSeconds + calc.overtimeSeconds,
        calc.pendingOvertimeSeconds,
      ),
      thresholdSeconds,
      paidSeconds,
      discardedSeconds,
      estimatedGross: roundUZS(regular.numerator + overtime.numerator),
      unratedSeconds: regular.unratedSeconds + overtime.unratedSeconds,
      numerator: (regular.numerator + overtime.numerator).toString(),
    };
  });
  const active = await c.env.DB.prepare(
    "SELECT * FROM attendance_sessions WHERE employee_id=? AND check_out IS NULL",
  )
    .bind(e.id)
    .first();
  const upcomingTo = localDate(Date.now() + 6 * 86400000),
    upcoming =
      today < period.from || upcomingTo > period.to
        ? await getShiftsRange(c.env.DB, e.id, today, upcomingTo)
        : shifts.filter(
            (s) => s.work_date >= today && s.work_date <= upcomingTo,
          );
  const todaySessions =
    days.find((d) => d.date === today)?.sessions ??
    (
      await c.env.DB.prepare(
        "SELECT * FROM effective_attendance WHERE employee_id=? AND work_date=? ORDER BY check_in,id",
      )
        .bind(e.id, today)
        .all<Session>()
    ).results;
  const todayAttendance = calculateAttendance(
    todaySessions,
    upcoming.filter((s) => s.work_date === today),
  );
  const absences = (
    await c.env.DB.prepare(
      "SELECT work_date,status,paid FROM employee_requests WHERE employee_id=? AND kind='absence' AND status!='rejected' AND (work_date BETWEEN ? AND ? OR work_date=?)",
    )
      .bind(e.id, period.from, period.to, today)
      .all()
  ).results;
  return c.json({
    today,
    serverTime: now(),
    active,
    checkout: (await openCheckoutTimings(c.env.DB, now())).find((s) => s.session.employee_id === e.id) ?? null,
    period,
    days,
    upcoming,
    todayAttendance,
    absences,
    summary: {
      actualSeconds: days.reduce((s, d) => s + d.actualSeconds, 0),
      regularSeconds: days.reduce((s, d) => s + d.regularSeconds, 0),
      overtimeSeconds: days.reduce((s, d) => s + d.overtimeSeconds, 0),
      paidSeconds: days.reduce((s, d) => s + d.paidSeconds, 0),
      estimatedGross: roundUZS(
        days.reduce((s, d) => s + BigInt(d.numerator), 0n),
      ),
      pending:
        !!active ||
        days.some(
          (d) =>
            d.openSessions ||
            d.pendingPaidSeconds ||
            d.earlyDepartureSeconds ||
            d.unratedSeconds,
        ),
    },
  });
});
attendanceRoutes.get("/attendance/live", async (c) => {
  requirePermission(c, "attendance.manage");
  const workDate = date.parse(c.req.query("date") ?? localDate()),
    shifts = await getShiftsRange(c.env.DB, null, workDate, workDate);
  const [people, records, open, approvals, absences] = await c.env.DB.batch<
    Record<string, string | number | null>
  >([
    c.env.DB.prepare(
      "SELECT e.id,u.full_name,u.active,e.activation_date,e.deactivation_date FROM employees e JOIN users u ON u.id=e.user_id ORDER BY u.full_name",
    ),
    c.env.DB.prepare(
      "SELECT a.*,EXISTS(SELECT 1 FROM automatic_checkouts x WHERE x.session_id=a.id) AS automatically_closed FROM effective_attendance a WHERE work_date=? ORDER BY check_in,id",
    ).bind(workDate),
    c.env.DB.prepare(
      "SELECT * FROM attendance_sessions WHERE check_out IS NULL",
    ),
    c.env.DB.prepare(
      "SELECT employee_id,start_at,end_at FROM overtime_approvals WHERE work_date=?",
    ).bind(workDate),
    c.env.DB.prepare(
      "SELECT employee_id,status,paid FROM employee_requests WHERE kind='absence' AND status!='rejected' AND work_date=?",
    ).bind(workDate),
  ]);
  const checkoutTimings = await openCheckoutTimings(c.env.DB, now());
  return c.json({
    date: workDate,
    serverTime: now(),
    employees: people.results.map((p) => {
      const sessions = records.results.filter(
          (s) => s.employee_id === p.id,
        ) as unknown as Session[],
        schedule = shifts.filter((s) => s.employee_id === p.id),
        active = open.results.find((s) => s.employee_id === p.id),
        calc = calculateAttendance(
          sessions,
          schedule,
          approvals.results
            .filter((o) => o.employee_id === p.id)
            .map((o) => ({ start: Number(o.start_at), end: Number(o.end_at) })),
          now(),
        );
      return {
        id: p.id,
        full_name: p.full_name,
        active: !!p.active,
        shifts: schedule,
        sessions,
        activeSession: active ?? null,
        ...calc,
        checkout: checkoutTimings.find((s) => s.session.employee_id === p.id) ?? null,
        forgotten: checkoutTimings.some((s) => s.session.employee_id === p.id && s.state === "review"),
        absence: absences.results.find((a) => a.employee_id === p.id) ?? null,
        status: active
          ? "Working"
          : !p.active ||
              String(p.activation_date) > workDate ||
              (p.deactivation_date && String(p.deactivation_date) <= workDate)
            ? "Inactive"
            : absences.results.some(
                  (a) => a.employee_id === p.id && a.status === "approved",
                )
              ? "Approved absence"
              : absences.results.some(
                    (a) => a.employee_id === p.id && a.status === "pending",
                  )
                ? "Absence pending"
                : sessions.length
                  ? "Finished"
                  : schedule.some((s) => s.status === "scheduled")
                    ? "Not checked in"
                    : "Unscheduled",
      };
    }),
  });
});
