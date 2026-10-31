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
import { audit, mutate, replayMutation } from "./data";
import { notify } from "./notifications";
import { date, reason } from "../shared/validation";
import { dayStart } from "../shared/attendance";
import { localDate } from "../shared/domain";
import { getShiftsRange } from "./schedules";

type RequestRow = {
  id: string;
  employee_id: string;
  kind: "absence" | "correction" | "overtime";
  work_date: string;
  payload_json: string;
  reason: string;
  status: string;
  paid: number;
};
type Payload = {
  category?: string;
  type?: string;
  sessionId?: string | null;
  start?: number;
  end?: number;
  originalIn?: number;
  originalOut?: number | null;
  shiftId?: string | null;
};
async function own(c: AppContext) {
  const e = await c.env.DB.prepare(
    "SELECT e.id,e.activation_date FROM employees e JOIN users u ON u.id=e.user_id WHERE e.user_id=? AND u.active=1 AND e.activation_date<=? AND (e.deactivation_date IS NULL OR e.deactivation_date>?)",
  )
    .bind(c.get("identity").id, localDate(), localDate())
    .first<{ id: string; activation_date: string }>();
  if (!e)
    throw new HTTPException(403, {
      message: "An active employee profile is required.",
    });
  return e;
}
function interval(workDate: string, start: number, end: number) {
  if (
    start < dayStart(workDate) ||
    end > dayStart(workDate) + 86400 ||
    end <= start ||
    end - start > 18 * 3600
  )
    throw new HTTPException(400, {
      message: "Choose an interval of up to 18 hours within the workday.",
    });
}
async function unlocked(c: AppContext, workDate: string) {
  if (
    await c.env.DB.prepare(
      "SELECT id FROM payroll_period_locks WHERE ? BETWEEN from_date AND to_date",
    )
      .bind(workDate)
      .first()
  )
    throw new HTTPException(409, {
      message: "Payroll is locked. Ask a payroll approver to reopen the month before correcting this record.",
    });
}
export const requestRoutes = new Hono<AppEnv>();
requestRoutes.post("/attendance/manual", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        employeeId: z.string().min(1).max(100),
        date,
        start: z.number().int().positive(),
        end: z.number().int().positive(),
        reason,
      })
      .strict(),
  );
  interval(i.date, i.start, i.end);
  if (i.end > now())
    throw new HTTPException(400, {
      message:
        "Manual attendance must use actual past arrival and departure times.",
    });
  const employee = await c.env.DB.prepare(
    "SELECT e.activation_date,e.deactivation_date,u.full_name FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=?",
  )
    .bind(i.employeeId)
    .first<{
      activation_date: string;
      deactivation_date: string | null;
      full_name: string;
    }>();
  if (!employee)
    throw new HTTPException(404, { message: "Employee not found." });
  if (
    i.date < employee.activation_date ||
    (employee.deactivation_date && i.date >= employee.deactivation_date)
  )
    throw new HTTPException(400, {
      message: "Choose a workday within this employee's employment dates.",
    });
  await unlocked(c, i.date);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM employee_requests WHERE employee_id=? AND work_date=? AND kind='correction' AND status='pending'",
    )
      .bind(i.employeeId, i.date)
      .first()
  )
    throw new HTTPException(409, {
      message:
        "This employee has a pending attendance correction for this date. Review it in Requests first.",
    });
  const shifts = await getShiftsRange(c.env.DB, i.employeeId, i.date, i.date),
    shiftId =
      shifts.find((s) => s.kind === "regular" && s.status === "scheduled" && s.start_at < i.end && s.end_at > i.start)
        ?.id ?? null;
  const id = crypto.randomUUID(),
    actor = c.get("identity").id;
  const payload = {
    type: "missing_check_in",
    sessionId: null,
    start: i.start,
    end: i.end,
    shiftId,
    administratorCorrection: true,
  };
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO employee_requests(id,employee_id,kind,work_date,payload_json,reason,created_at) VALUES(?,?,'correction',?,?,?,?)",
      ).bind(
        id,
        i.employeeId,
        i.date,
        JSON.stringify(payload),
        i.reason,
        now(),
      ),
      c.env.DB.prepare(
        "UPDATE employee_requests SET status='approved',decided_by=?,decided_at=?,decision_reason=? WHERE id=?",
      ).bind(actor, now(), i.reason || null, id),
      c.env.DB.prepare(
        "INSERT INTO manual_attendance(id,employee_id,work_date,shift_id,check_in,check_out) VALUES(?,?,?,?,?,?)",
      ).bind(id, i.employeeId, i.date, shiftId, i.start, i.end),
      audit(
        c,
        "attendance.manual.add",
        id,
        null,
        {
          employeeId: i.employeeId,
          employeeName: employee.full_name,
          workDate: i.date,
          checkIn: i.start,
          checkOut: i.end,
        },
        i.reason,
      ),
      notify(
        c.env.DB,
        `manual-attendance:${id}`,
        `Your attendance for ${i.date} was recorded by an administrator. Open your workspace to review the arrival and departure times.`,
        i.employeeId,
      ),
    ],
    { id, ok: true },
    201,
  );
});
requestRoutes.post("/attendance/:id/correct-checkout", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        checkout: z.number().int().positive(),
        expectedCheckIn: z.number().int().positive(),
        expectedCheckout: z.number().int().positive(),
        reason,
      })
      .strict(),
  );
  const session = await c.env.DB.prepare(
    "SELECT * FROM attendance_sessions WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      employee_id: string;
      work_date: string;
      check_in: number;
      check_out: number | null;
      shift_id: string | null;
    }>();
  if (!session)
    throw new HTTPException(404, { message: "Attendance session not found." });
  if (
    session.check_in !== i.expectedCheckIn ||
    session.check_out !== i.expectedCheckout
  )
    throw new HTTPException(409, {
      message: "Attendance changed. Refresh and review the latest times.",
    });
  await unlocked(c, session.work_date);
  interval(session.work_date, session.check_in, i.checkout);
  if (i.checkout > now())
    throw new HTTPException(400, {
      message: "The actual departure time cannot be in the future.",
    });
  const id = crypto.randomUUID(),
    actor = c.get("identity").id;
  const payload = {
    type: "incorrect_times",
    sessionId: session.id,
    start: session.check_in,
    end: i.checkout,
    originalIn: session.check_in,
    originalOut: session.check_out,
    shiftId: session.shift_id,
    administratorCorrection: true,
  };
  // Existing approval triggers check timestamp freshness, overlap and locks atomically.
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO employee_requests(id,employee_id,kind,work_date,payload_json,reason,created_at) VALUES(?,?,'correction',?,?,?,?)",
      ).bind(
        id,
        session.employee_id,
        session.work_date,
        JSON.stringify(payload),
        i.reason,
        now(),
      ),
      c.env.DB.prepare(
        "UPDATE employee_requests SET status='approved',decided_by=?,decided_at=?,decision_reason=? WHERE id=?",
      ).bind(actor, now(), i.reason || null, id),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO attendance_originals(session_id,original_json) VALUES(?,?)",
      ).bind(session.id, JSON.stringify(session)),
      c.env.DB.prepare(
        "UPDATE attendance_sessions SET check_out=?,checkout_source='admin',checkout_reason=?,closed_by=? WHERE id=?",
      ).bind(i.checkout, i.reason, actor, session.id),
      audit(
        c,
        "attendance.checkout.correct",
        session.id,
        session,
        { checkout: i.checkout, workDate: session.work_date, correctionId: id },
        i.reason,
      ),
    ],
    { ok: true },
  );
});
requestRoutes.get("/requests/categories", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT * FROM absence_categories ORDER BY rowid",
      ).all()
    ).results,
  ),
);
requestRoutes.post("/requests/categories/:id", async (c) => {
  superAdmin(c);
  const i = await body(c, z.object({ paid: z.boolean(), reason }).strict()),
    id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT * FROM absence_categories WHERE id=?",
  )
    .bind(id)
    .first();
  if (!before) throw new HTTPException(404, { message: "Category not found." });
  return mutate(
    c,
    [
      c.env.DB.prepare("UPDATE absence_categories SET paid=? WHERE id=?").bind(
        Number(i.paid),
        id,
      ),
      audit(c, "absence.policy", id, before, i, i.reason),
    ],
    { ok: true },
  );
});
requestRoutes.get("/requests/mine", async (c) => {
  const e = await own(c);
  const [requests, coverage] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT * FROM employee_requests WHERE employee_id=? ORDER BY created_at DESC,id LIMIT 100",
    ).bind(e.id),
    c.env.DB.prepare(
      "SELECT * FROM shift_coverage_assignments WHERE employee_id=? ORDER BY created_at DESC,id LIMIT 100",
    ).bind(e.id),
  ]);
  return c.json({ requests: requests.results, coverage: coverage.results });
});
requestRoutes.get("/requests/review", async (c) => {
  requirePermission(c, "attendance.manage");
  const [requests, coverage] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT r.*,u.full_name FROM employee_requests r JOIN employees e ON e.id=r.employee_id JOIN users u ON u.id=e.user_id ORDER BY (r.status='pending') DESC,r.created_at DESC,r.id LIMIT 200",
    ),
    c.env.DB.prepare(
      "SELECT s.*,u.full_name FROM shift_coverage_assignments s JOIN employees e ON e.id=s.employee_id JOIN users u ON u.id=e.user_id ORDER BY s.created_at DESC LIMIT 200",
    ),
  ]);
  return c.json({ requests: requests.results, coverage: coverage.results });
});
const input = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("absence"),
      date,
      category: z.enum(["sick", "personal", "emergency", "other"]),
      reason: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z
    .object({
      kind: z.literal("overtime"),
      date,
      start: z.number().int().positive(),
      end: z.number().int().positive(),
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("correction"),
      date,
      type: z.enum([
        "missing_check_in",
        "missing_check_out",
        "qr_unavailable",
        "wrong_check_in",
        "wrong_check_out",
      ]),
      sessionId: z.string().min(1).max(100).nullable(),
      start: z.number().int().positive(),
      end: z.number().int().positive(),
      reason,
    })
    .strict(),
]);
requestRoutes.post("/requests", async (c) => {
  const replay = await replayMutation(c);
  if (replay) return replay;
  const e = await own(c),
    i = await body(c, input),
    id = crypto.randomUUID();
  if (
    i.date < e.activation_date ||
    i.date > localDate(Date.now() + 366 * 86400000)
  )
    throw new HTTPException(400, {
      message: "Choose a date during employment and within the next year.",
    });
  await unlocked(c, i.date);
  const p: Payload = {};
  if (i.kind === "absence") {
    p.category = i.category;
    const cover = await c.env.DB.prepare(
      "SELECT id FROM shift_coverage_assignments WHERE employee_id=? AND work_date=? AND status!='declined'",
    )
      .bind(e.id, i.date)
      .first();
    if (cover)
      throw new HTTPException(409, {
        message:
          "Coverage is already assigned on this date. Contact your administrator.",
      });
  } else {
    interval(i.date, i.start, i.end);
    p.start = i.start;
    p.end = i.end;
    if (i.kind === "correction") {
      if (i.end > now())
        throw new HTTPException(400, {
          message: "Corrected attendance cannot be in the future.",
        });
      p.type = i.type;
      p.sessionId = i.sessionId;
      if (i.sessionId) {
        const s = await c.env.DB.prepare(
          "SELECT * FROM attendance_sessions WHERE id=? AND employee_id=? AND work_date=?",
        )
          .bind(i.sessionId, e.id, i.date)
          .first<{
            check_in: number;
            check_out: number | null;
            shift_id: string | null;
          }>();
        if (!s)
          throw new HTTPException(404, {
            message: "Attendance session not found on this date.",
          });
        p.originalIn = s.check_in;
        p.originalOut = s.check_out;
        p.shiftId = s.shift_id;
      } else {
        if (!["missing_check_in", "qr_unavailable"].includes(i.type))
          throw new HTTPException(400, {
            message: "Choose a session for this correction type.",
          });
        const shifts = await getShiftsRange(c.env.DB, e.id, i.date, i.date);
        p.shiftId =
          shifts.find((s) => s.kind === "regular" && s.status === "scheduled" && s.start_at < i.end && s.end_at > i.start)
            ?.id ?? null;
      }
    }
  }
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO employee_requests(id,employee_id,kind,work_date,payload_json,reason,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(id, e.id, i.kind, i.date, JSON.stringify(p), i.reason, now()),
      audit(c, `request.${i.kind}.create`, id, null, {
        ...i,
        lateSubmitted: i.date < localDate(),
      }),
      notify(
        c.env.DB,
        `request:${id}`,
        `A new ${i.kind} request needs review for ${i.date}. Open the requests screen.`,
        undefined,
        true,
      ),
    ],
    { id },
    201,
  );
});
requestRoutes.post("/requests/:id/decision", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, z.object({ approved: z.boolean(), reason }).strict()),
    id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT * FROM employee_requests WHERE id=?")
    .bind(id)
    .first<RequestRow>();
  if (!r) throw new HTTPException(404, { message: "Request not found." });
  if (r.status !== "pending")
    throw new HTTPException(409, { message: "Request already decided." });
  const p = JSON.parse(r.payload_json) as Payload,
    status = i.approved ? "approved" : "rejected",
    actor = c.get("identity").id;
  if (i.approved) await unlocked(c, r.work_date);
  const statements: D1PreparedStatement[] = [];
  let paid = 0;
  if (i.approved && r.kind === "absence")
    paid = (await c.env.DB.prepare(
      "SELECT paid FROM absence_categories WHERE id=?",
    )
      .bind(p.category!)
      .first<{ paid: number }>())!.paid;
  statements.push(
    c.env.DB.prepare(
      "UPDATE employee_requests SET status=?,decided_by=?,decided_at=?,decision_reason=?,paid=? WHERE id=?",
    ).bind(status, actor, now(), i.reason || null, paid, id),
  );
  if (i.approved && r.kind === "overtime")
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO overtime_approvals(id,employee_id,work_date,start_at,end_at,reason,approved_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        r.employee_id,
        r.work_date,
        p.start!,
        p.end!,
        i.reason,
        actor,
        now(),
      ),
    );
  if (i.approved && r.kind === "correction") {
    if (p.end! > now())
      throw new HTTPException(400, {
        message: "Corrected attendance cannot be in the future.",
      });
    if (p.sessionId) {
      const original = await c.env.DB.prepare(
        "SELECT * FROM attendance_sessions WHERE id=?",
      )
        .bind(p.sessionId)
        .first();
      statements.push(
        c.env.DB.prepare(
          "INSERT OR IGNORE INTO attendance_originals(session_id,original_json) VALUES(?,?)",
        ).bind(p.sessionId, JSON.stringify(original)),
      );
      if (p.originalOut === null)
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO attendance_closures(session_id,closed_at) VALUES(?,?)",
          ).bind(p.sessionId, p.end!),
        );
      statements.push(
        c.env.DB.prepare(
          "UPDATE attendance_sessions SET check_in=?,check_out=?,checkout_source='admin',checkout_reason=?,closed_by=? WHERE id=?",
        ).bind(p.start!, p.end!, i.reason, actor, p.sessionId),
      );
    } else
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO manual_attendance(id,employee_id,work_date,shift_id,check_in,check_out) VALUES(?,?,?,?,?,?)",
        ).bind(
          id,
          r.employee_id,
          r.work_date,
          p.shiftId ?? null,
          p.start!,
          p.end!,
        ),
      );
  }
  statements.push(
    audit(
      c,
      `request.${r.kind}.${status}`,
      id,
      r,
      { status, paid, payload: p },
      i.reason,
    ),
    notify(
      c.env.DB,
      `decision:${id}`,
      i.approved && r.kind === "absence" && p.category === "sick"
        ? `Take care 💜 Your sick leave for ${r.work_date} has been approved. Rest up and feel better soon—wishing you a smooth recovery 🌿`
        : `Your ${r.kind} request for ${r.work_date} was ${status} ${i.approved ? "✅" : "📋"} Open your workspace for the details.`,
      r.employee_id,
    ),
  );
  if (i.approved && r.kind === "absence")
    statements.push(
      notify(
        c.env.DB,
        `coverage-needed:${id}`,
        `An absence was approved for ${r.work_date}. Assign shift coverage if needed.`,
        undefined,
        true,
      ),
    );
  return mutate(c, statements, { ok: true, status, paid });
});
const coverageSchema = z
  .object({
    absenceId: z.string().min(1).max(100),
    employeeId: z.string().min(1).max(100),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    requiresAcceptance: z.boolean(),
    overtimeApproved: z.literal(true),
    reason,
  })
  .strict();
function coverageShift(
  c: AppContext,
  r: {
    id: string;
    employee_id: string;
    work_date: string;
    start_at: number;
    end_at: number;
  },
) {
  return c.env.DB.prepare(
    "INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,overtime_approved,source_id,created_by,created_at) VALUES(?,?,?,?,?,'extra','scheduled',1,?,?,?)",
  ).bind(
    crypto.randomUUID(),
    r.employee_id,
    r.work_date,
    r.start_at,
    r.end_at,
    r.id,
    c.get("identity").id,
    now(),
  );
}
requestRoutes.post("/coverage", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, coverageSchema),
    id = crypto.randomUUID();
  const absence = await c.env.DB.prepare(
    "SELECT * FROM employee_requests WHERE id=? AND kind='absence' AND status='approved'",
  )
    .bind(i.absenceId)
    .first<RequestRow>();
  if (!absence)
    throw new HTTPException(404, { message: "Approved absence not found." });
  if (absence.work_date < localDate())
    throw new HTTPException(400, {
      message: "Coverage must be today or in the future.",
    });
  interval(absence.work_date, i.start, i.end);
  await unlocked(c, absence.work_date);
  await getShiftsRange(
    c.env.DB,
    i.employeeId,
    absence.work_date,
    absence.work_date,
  );
  const r = {
    id,
    employee_id: i.employeeId,
    work_date: absence.work_date,
    start_at: i.start,
    end_at: i.end,
  };
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO shift_coverage_assignments(id,absence_id,employee_id,work_date,start_at,end_at,reason,status,requires_acceptance,overtime_approved,created_by,created_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)",
    ).bind(
      id,
      i.absenceId,
      i.employeeId,
      absence.work_date,
      i.start,
      i.end,
      i.reason,
      i.requiresAcceptance ? "pending" : "accepted",
      Number(i.requiresAcceptance),
      c.get("identity").id,
      now(),
      i.requiresAcceptance ? null : now(),
    ),
  ];
  if (!i.requiresAcceptance) statements.push(coverageShift(c, r));
  statements.push(
    audit(c, "coverage.create", id, null, i, i.reason),
    notify(
      c.env.DB,
      `coverage:${id}`,
      `You have a coverage assignment for ${absence.work_date}.${i.requiresAcceptance ? " Please accept or decline in your workspace." : ""}`,
      i.employeeId,
    ),
  );
  return mutate(c, statements, { id }, 201);
});
requestRoutes.post("/coverage/:id/decision", async (c) => {
  const replay = await replayMutation(c);
  if (replay) return replay;
  const e = await own(c),
    i = await body(c, z.object({ accepted: z.boolean(), reason }).strict()),
    id = c.req.param("id");
  const r = await c.env.DB.prepare(
    "SELECT * FROM shift_coverage_assignments WHERE id=? AND employee_id=?",
  )
    .bind(id, e.id)
    .first<{
      id: string;
      employee_id: string;
      work_date: string;
      start_at: number;
      end_at: number;
      status: string;
    }>();
  if (!r) throw new HTTPException(404, { message: "Coverage not found." });
  if (r.status !== "pending")
    throw new HTTPException(409, { message: "Coverage already decided." });
  if (i.accepted && (r.work_date < localDate() || r.end_at <= now()))
    throw new HTTPException(409, {
      message: "This coverage shift has already ended.",
    });
  if (i.accepted)
    await getShiftsRange(c.env.DB, e.id, r.work_date, r.work_date);
  const status = i.accepted ? "accepted" : "declined",
    statements = [
      c.env.DB.prepare(
        "UPDATE shift_coverage_assignments SET status=?,decided_at=? WHERE id=?",
      ).bind(status, now(), id),
    ];
  if (i.accepted) statements.push(coverageShift(c, r));
  statements.push(
    audit(c, `coverage.${status}`, id, r, i, i.reason),
    notify(
      c.env.DB,
      `coverage-decision:${id}`,
      `Shift coverage was ${status} for ${r.work_date}. Review the requests screen.`,
      undefined,
      true,
    ),
  );
  return mutate(c, statements, { ok: true, status });
});
requestRoutes.get("/attendance/history", async (c) => {
  const e = await own(c),
    from = date.parse(c.req.query("from") ?? localDate()),
    to = date.parse(c.req.query("to") ?? localDate());
  if (to < from || (dayStart(to) - dayStart(from)) / 86400 >= 31)
    throw new HTTPException(400, {
      message: "Choose a range of up to 31 days.",
    });
  const [sessions, requests, originals] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT * FROM effective_attendance WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date,check_in,id",
    ).bind(e.id, from, to),
    c.env.DB.prepare(
      "SELECT * FROM employee_requests WHERE employee_id=? AND work_date BETWEEN ? AND ? ORDER BY created_at,id",
    ).bind(e.id, from, to),
    c.env.DB.prepare(
      "SELECT o.* FROM attendance_originals o JOIN attendance_sessions s ON s.id=o.session_id WHERE s.employee_id=? AND s.work_date BETWEEN ? AND ?",
    ).bind(e.id, from, to),
  ]);
  return c.json({
    from,
    to,
    sessions: sessions.results,
    requests: requests.results,
    originals: originals.results,
  });
});
