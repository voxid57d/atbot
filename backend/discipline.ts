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
import { localDate } from "../shared/domain";
import {
  disciplinePeriod,
  disciplineProgression,
  type DisciplinePolicy,
  type ViolationSource,
  type ViolationDecision,
} from "../shared/discipline";
import { getShiftsRange } from "./schedules";
import { openCheckoutTimings } from "./checkout";
import { disciplineReviewTasks } from "../shared/review-tasks";
import { paidHourSeconds } from "../shared/payroll";
import {
  calculateAttendance,
  sessionsForRegularShift,
  type Session,
  type Shift,
} from "../shared/attendance";

export const disciplineRoutes = new Hono<AppEnv>();
const revision = z.number().int().nonnegative();
const employeeId = z.string().min(1).max(100);
const reviewBase = { employeeId, date, revision };
type Workday = {
  employee_id: string;
  work_date: string;
  attendance_snapshot: string;
  open_sessions: number;
  first_in: number;
  last_time: number;
};
type Quality = {
  employee_id: string;
  work_date: string;
  rating: string;
  comment: string;
  attendance_snapshot: string;
  reviewed_by: string;
  reviewed_at: number;
};
type Uniform = {
  employee_id: string;
  work_date: string;
  declared_at: number | null;
  declared_has_uniform: number;
  admin_has_uniform: number | null;
  status: string;
  decision_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
};
type Early = {
  shift_id: string;
  employee_id: string;
  work_date: string;
  source_token: string;
  status: string;
  reason: string;
};
type Meeting = {
  violation_id: string;
  progression_token: string;
  reason: string;
  completed_at: number;
  completed_by: string;
};
function conflict(
  message = "This review changed. Refresh and try again.",
): never {
  throw new HTTPException(409, { message });
}
function guard(c: AppContext, expected: number) {
  return c.env.DB.prepare(
    "UPDATE discipline_state SET revision=? WHERE id=1",
  ).bind(expected + 1);
}
async function own(c: AppContext) {
  const e = await c.env.DB.prepare(
    "SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id WHERE e.user_id=? AND u.active=1 AND e.activation_date<=? AND (e.deactivation_date IS NULL OR e.deactivation_date>?)",
  )
    .bind(c.get("identity").id, localDate(), localDate())
    .first<{ id: string }>();
  if (!e)
    throw new HTTPException(403, {
      message: "An active employee profile is required.",
    });
  return e.id;
}
async function workday(c: AppContext, id: string, workDate: string) {
  const w = await c.env.DB.prepare(
    "SELECT * FROM discipline_workdays WHERE employee_id=? AND work_date=?",
  )
    .bind(id, workDate)
    .first<Workday>();
  if (!w || workDate > localDate())
    throw new HTTPException(400, {
      message: "Choose a recorded workday, today or earlier.",
    });
  return w;
}
async function unlocked(c: AppContext, workDate: string) {
  if (
    await c.env.DB.prepare(
      "SELECT id FROM payroll_period_locks WHERE ? BETWEEN from_date AND to_date",
    )
      .bind(workDate)
      .first()
  )
    conflict("Payroll is locked. Ask a payroll approver to reopen the month before correcting this record.");
}
async function period(c: AppContext, workDate: string) {
  const settings = await c.env.DB.prepare(
    "SELECT payroll_start_day FROM system_settings WHERE id=1",
  ).first<{ payroll_start_day: number }>();
  return disciplinePeriod(workDate, settings!.payroll_start_day);
}
export async function disciplineSnapshot(
  c: AppContext,
  workDate: string,
  employee: string | null,
) {
  const range = await period(c, workDate);
  await getShiftsRange(c.env.DB, employee, range.from, range.to);
  const filter = employee ? " AND employee_id=?" : "";
  const args = employee
    ? [range.from, range.to, employee]
    : [range.from, range.to];
  const sql = (table: string) =>
    c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE work_date BETWEEN ? AND ?${filter}`,
    ).bind(...args);
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT revision FROM discipline_state WHERE id=1"),
    c.env.DB.prepare(
      "SELECT * FROM disciplinary_policies WHERE effective_date<=? ORDER BY effective_date DESC,id DESC LIMIT 1",
    ).bind(range.from),
    sql("discipline_workdays"),
    sql("daily_work_reviews"),
    sql("daily_uniform_confirmations"),
    sql("discipline_sources"),
    sql("violation_decisions"),
    sql("early_departure_reviews"),
    sql("scheduled_shifts"),
    sql("effective_attendance"),
    sql("manager_meetings"),
    c.env.DB.prepare(
      `SELECT e.id,u.full_name,u.active FROM employees e JOIN users u ON u.id=e.user_id${employee ? " WHERE e.id=?" : ""}`,
    ).bind(...(employee ? [employee] : [])),
    c.env.DB.prepare(
      "SELECT id,from_date,to_date FROM payroll_period_locks WHERE from_date<=? AND to_date>=?",
    ).bind(range.to, range.from),
    c.env.DB.prepare(
      `SELECT r.id,r.employee_id,r.kind,r.work_date,r.reason,r.status FROM employee_requests r WHERE r.status='pending'${employee ? " AND r.employee_id=?" : ""} ORDER BY r.created_at,r.id`,
    ).bind(...(employee ? [employee] : [])),
    c.env.DB.prepare(
      `SELECT id,employee_id,work_date,check_in FROM attendance_sessions WHERE check_out IS NULL${employee ? " AND employee_id=?" : ""} ORDER BY check_in,id`,
    ).bind(...(employee ? [employee] : [])),
    sql("discipline_source_history"),
    c.env.DB.prepare(`SELECT f.*,u.full_name AS decided_by_name FROM payroll_fine_decisions f
      LEFT JOIN users u ON u.id=f.decided_by WHERE f.work_date BETWEEN ? AND ?${filter}`).bind(...args),
    sql("overtime_approvals"),
  ]);
  const policyRow = results[1].results[0] as {
    id: number;
    effective_date: string;
    policy_json: string;
  };
  const policy = JSON.parse(policyRow.policy_json) as DisciplinePolicy;
  const qualities = results[3].results as unknown as Quality[],
    uniforms = results[4].results as unknown as Uniform[];
  const meetings = results[10].results as unknown as Meeting[];
  const fineDecisions = results[16].results as {
    violation_id: string; progression_token: string; status: string; amount: number;
    reason: string; decided_by: string; decided_at: number; decided_by_name: string | null;
  }[];
  const violations = disciplineProgression(
    results[5].results as unknown as ViolationSource[],
    results[6].results as unknown as ViolationDecision[],
    policy,
  ).map((v) => ({
    ...v,
    fineReviewed: fineDecisions.some(
      (f) =>
        f.violation_id === v.id && f.progression_token === v.progressionToken,
    ),
    fineDecision: fineDecisions.find((f) => f.violation_id === v.id && f.progression_token === v.progressionToken) ?? null,
    meeting:
      meetings.find(
        (m) =>
          m.violation_id === v.id && m.progression_token === v.progressionToken,
      ) ?? null,
  }));
  const sessions = results[9].results as unknown as (Session & {
    employee_id: string;
    work_date: string;
  })[];
  const shifts = results[8].results as unknown as (Shift & { employee_id: string })[];
  const overtime = results[17].results as { employee_id: string; work_date: string; start_at: number; end_at: number }[];
  const days = (results[2].results as unknown as Workday[]).map((w) => {
    const q = qualities.find(
      (r) => r.employee_id === w.employee_id && r.work_date === w.work_date,
    );
    const dayShifts = shifts.filter((s) => s.employee_id === w.employee_id && s.work_date === w.work_date);
    const daySessions = sessions.filter((s) => s.employee_id === w.employee_id && s.work_date === w.work_date);
    const calc = calculateAttendance(daySessions, dayShifts, overtime
      .filter((s) => s.employee_id === w.employee_id && s.work_date === w.work_date)
      .map((s) => ({ start: s.start_at, end: s.end_at })));
    return {
      ...w,
      ...calc,
      shifts: dayShifts,
      sessions: daySessions,
      paidSeconds: paidHourSeconds(calc.regularSeconds + calc.overtimeSeconds),
      inProgress: w.open_sessions > 0 || dayShifts.some((s) => s.status === "scheduled" && s.end_at > now()),
      quality: q ?? null,
      qualityPending: !q || q.attendance_snapshot !== w.attendance_snapshot,
      uniform:
        uniforms.find(
          (r) => r.employee_id === w.employee_id && r.work_date === w.work_date,
        ) ?? null,
    };
  });
  const early = shifts
    .filter((s) => s.kind === "regular" && s.status === "scheduled")
    .flatMap((s) => {
      const employeeShifts = shifts.filter((a) => a.employee_id === s.employee_id && a.work_date === s.work_date);
      const records = sessionsForRegularShift(sessions.filter((a) => a.employee_id === s.employee_id && a.work_date === s.work_date), s, employeeShifts);
      const calc = calculateAttendance(records, employeeShifts).shiftAttendance.find((a) => a.shiftId === s.id)!;
      if (!records.length || calc.openSessions || !calc.earlyDepartureSeconds)
        return [];
      const token = JSON.stringify([
        s.start_at,
        s.end_at,
        records.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
      ]);
      const r = (results[7].results as unknown as Early[]).find(
        (r) => r.shift_id === s.id && r.source_token === token,
      );
      return [
        {
          shiftId: s.id,
          employee_id: s.employee_id,
          work_date: s.work_date,
          missedSeconds: calc.earlyDepartureSeconds,
          sourceToken: token,
          review: r ?? null,
        },
      ];
    });
  const openAttendance = (await openCheckoutTimings(c.env.DB, now()))
    .filter((s) => !employee || s.session.employee_id === employee)
    .map((s) => ({ ...s.session, state: s.state, expectedEnd: s.expectedEnd }));
  const locks = results[12].results as { from_date: string; to_date: string }[];
  const requests = results[13].results as { id: string; employee_id: string; work_date: string; kind: string; reason: string; status: string }[];
  const tasks = disciplineReviewTasks({ days, violations, early, requests, checkouts: openAttendance, period: range, locks });
  return {
    revision: Number((results[0].results[0] as { revision: number }).revision),
    period: range,
    policy,
    policyId: policyRow.id,
    policyEffectiveDate: policyRow.effective_date,
    days,
    violations,
    early,
    people: results[11].results as unknown as {
      id: string;
      full_name: string;
      active: number;
    }[],
    locks,
    requests,
    openAttendance,
    tasks,
    fineDecisions,
    history: results[15].results,
    fineApprovalAvailable: false,
    summary: {
      mandatoryPending:
        days.filter((d) => d.qualityPending).length +
        days.filter((d) => !d.uniform || d.uniform.status === "pending").length,
      latenessPending: violations.filter((v) => v.status === "detected").length,
      earlyPending: early.filter((e) => !e.review).length,
      meetingPending: violations.filter((v) => v.meetingRequired && !v.meeting)
        .length,
      countedViolations: violations.filter((v) => v.ordinal > 0).length,
      proposedFineTotal: violations.reduce(
        (s, v) => s + (v.proposedFine ?? 0),
        0,
      ),
      unconfiguredFines: violations.filter(
        (v) => v.fineStatus === "configuration_required",
      ).length,
    },
  };
}
disciplineRoutes.get("/discipline/mine", async (c) =>
  c.json(
    await disciplineSnapshot(
      c,
      date.parse(c.req.query("periodDate") ?? localDate()),
      await own(c),
    ),
  ),
);
disciplineRoutes.get("/discipline/today", async (c) => {
  const id = await own(c),
    today = localDate();
  const rows = await c.env.DB.batch([
    c.env.DB.prepare("SELECT revision FROM discipline_state WHERE id=1"),
    c.env.DB.prepare(
      "SELECT * FROM daily_uniform_confirmations WHERE employee_id=? AND work_date=?",
    ).bind(id, today),
    c.env.DB.prepare(
      "SELECT employee_id FROM discipline_workdays WHERE employee_id=? AND work_date=?",
    ).bind(id, today),
  ]);
  return c.json({
    revision: Number((rows[0].results[0] as { revision: number }).revision),
    today,
    uniform: rows[1].results[0] ?? null,
    worked: !!rows[2].results.length,
  });
});
disciplineRoutes.get("/discipline/review", async (c) => {
  requirePermission(c, "attendance.manage");
  return c.json(
    await disciplineSnapshot(
      c,
      date.parse(c.req.query("periodDate") ?? localDate()),
      null,
    ),
  );
});
disciplineRoutes.post("/discipline/uniform", async (c) => {
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
      c,
      z
        .object({
          revision,
          hasUniform: z.boolean().default(true),
          amend: z.boolean().default(false),
          reason,
        })
        .strict(),
    ),
    id = await own(c),
    workDate = localDate();
  await workday(c, id, workDate);
  await unlocked(c, workDate);
  const before = await c.env.DB.prepare(
    "SELECT * FROM daily_uniform_confirmations WHERE employee_id=? AND work_date=?",
  )
    .bind(id, workDate)
    .first<Uniform>();
  if (before?.declared_at && !i.amend)
    conflict("Your uniform declaration is already recorded for today.");
  if (i.amend && (!before?.declared_at || before.status !== "pending"))
    conflict(
      "Only an unreviewed declaration can be corrected. Ask your administrator to return a reviewed declaration to pending first.",
    );
  // A late declaration never erases an administrator's existing decision.
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO daily_uniform_confirmations(employee_id,work_date,declared_at,declared_has_uniform) VALUES(?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET declared_at=excluded.declared_at,declared_has_uniform=excluded.declared_has_uniform",
      ).bind(id, workDate, now(), Number(i.hasUniform)),
      audit(
        c,
        i.amend ? "uniform.correct" : "uniform.declare",
        `${id}:${workDate}`,
        before,
        i,
        i.reason,
      ),
    ],
    { ok: true },
  );
});
const qualityInput = z.object({
  ...reviewBase,
  rating: z.enum(["excellent", "good", "bad"]),
  comment: z.string().trim().max(1000).default(""),
  reason,
});
const uniformInput = z.object({
  ...reviewBase,
  status: z.enum(["approved", "rejected", "pending"]),
  hasUniform: z.boolean().optional(),
  reason,
});
// Validation and statements for one quality review; the caller adds the revision guard.
async function qualityStatements(
  c: AppContext,
  i: z.infer<typeof qualityInput>,
) {
  const w = await workday(c, i.employeeId, i.date);
  await unlocked(c, i.date);
  const before = await c.env.DB.prepare(
    "SELECT * FROM daily_work_reviews WHERE employee_id=? AND work_date=?",
  )
    .bind(i.employeeId, i.date)
    .first();
  return [
    c.env.DB.prepare(
      "INSERT INTO daily_work_reviews(employee_id,work_date,rating,comment,attendance_snapshot,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET rating=excluded.rating,comment=excluded.comment,attendance_snapshot=excluded.attendance_snapshot,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at",
    ).bind(
      i.employeeId,
      i.date,
      i.rating,
      i.comment,
      w.attendance_snapshot,
      c.get("identity").id,
      now(),
    ),
    audit(
      c,
      "quality.review",
      `${i.employeeId}:${i.date}`,
      before,
      i,
      i.reason,
    ),
    ...(i.rating === "bad"
      ? [
          notify(
            c.env.DB,
            `quality:${i.employeeId}:${i.date}:${i.revision}`,
            `A bad work-quality review was confirmed for ${i.date}. Review your discipline screen for details.`,
            i.employeeId,
          ),
        ]
      : []),
  ];
}
async function uniformStatements(
  c: AppContext,
  i: z.infer<typeof uniformInput>,
) {
  await workday(c, i.employeeId, i.date);
  await unlocked(c, i.date);
  const before = await c.env.DB.prepare(
    "SELECT * FROM daily_uniform_confirmations WHERE employee_id=? AND work_date=?",
  )
    .bind(i.employeeId, i.date)
    .first<Uniform>();
  if (i.hasUniform !== undefined && before?.declared_at)
    throw new HTTPException(400, { message: "The employee has already submitted a uniform choice. Review that declaration." });
  if (i.hasUniform !== undefined && (i.status === "pending" || (i.status === "approved") !== i.hasUniform))
    throw new HTTPException(400, { message: "Choose approved for wearing uniform or rejected for no uniform." });
  if (
    i.status === "approved" &&
    !(before?.declared_at ? before.declared_has_uniform : (i.hasUniform ?? before?.admin_has_uniform))
  )
    throw new HTTPException(400, {
      message:
        "Record the missing uniform choice before approving, or review the employee's declaration.",
    });
  return [
    c.env.DB.prepare(
      "INSERT INTO daily_uniform_confirmations(employee_id,work_date,status,decision_reason,reviewed_by,reviewed_at,admin_has_uniform) VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET status=excluded.status,decision_reason=excluded.decision_reason,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,admin_has_uniform=excluded.admin_has_uniform",
    ).bind(
      i.employeeId,
      i.date,
      i.status,
      i.reason,
      i.status === "pending" ? null : c.get("identity").id,
      i.status === "pending" ? null : now(),
      i.status === "pending" ? null : (i.hasUniform === undefined ? before?.admin_has_uniform ?? null : Number(i.hasUniform)),
    ),
    audit(
      c,
      "uniform.review",
      `${i.employeeId}:${i.date}`,
      before,
      i,
      i.reason,
    ),
    ...(i.status === "rejected"
      ? [
          notify(
            c.env.DB,
            `uniform-rejected:${i.employeeId}:${i.date}:${i.revision}`,
            `A uniform violation was confirmed for ${i.date}. Open your discipline screen for the reason.`,
            i.employeeId,
          ),
        ]
      : []),
  ];
}
disciplineRoutes.post("/discipline/quality", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, qualityInput.strict());
  return mutate(
    c,
    [guard(c, i.revision), ...(await qualityStatements(c, i))],
    { ok: true },
  );
});
disciplineRoutes.post("/discipline/uniform/decision", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, uniformInput.strict());
  return mutate(
    c,
    [guard(c, i.revision), ...(await uniformStatements(c, i))],
    { ok: true },
  );
});
// Saves quality and/or uniform for one or more workdays atomically: "Confirm day" sends
// one day, "Approve all as shown" sends many. One revision guard covers the whole batch.
disciplineRoutes.post("/discipline/days", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        revision,
        reason,
        days: z
          .array(
            z
              .object({
                employeeId,
                date,
                quality: z
                  .object({
                    rating: qualityInput.shape.rating,
                    comment: qualityInput.shape.comment,
                  })
                  .strict()
                  .optional(),
                uniform: z
                  .object({
                    status: uniformInput.shape.status,
                    hasUniform: z.boolean().optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .refine((d) => d.quality || d.uniform, "Nothing to save"),
          )
          .min(1)
          // Up to six lookups per day; five days stay under the Workers Free limit of
          // 50 D1 queries per request.
          .max(5),
      })
      .strict(),
  );
  if (
    new Set(i.days.map((d) => `${d.employeeId}:${d.date}`)).size !==
    i.days.length
  )
    throw new HTTPException(400, { message: "Each workday can appear once." });
  const statements: D1PreparedStatement[] = [guard(c, i.revision)];
  for (const d of i.days) {
    const common = {
      employeeId: d.employeeId,
      date: d.date,
      revision: i.revision,
      reason: i.reason,
    };
    if (d.quality)
      statements.push(
        ...(await qualityStatements(c, { ...common, ...d.quality })),
      );
    if (d.uniform)
      statements.push(
        ...(await uniformStatements(c, { ...common, ...d.uniform })),
      );
  }
  // The guard adds one and each quality/uniform write adds one through its revision trigger,
  // so the client can send its next batch without reloading the whole review snapshot.
  const writes = i.days.reduce(
    (n, d) => n + Number(!!d.quality) + Number(!!d.uniform),
    0,
  );
  return mutate(c, statements, {
    ok: true,
    saved: i.days.length,
    revision: i.revision + 1 + writes,
  });
});
disciplineRoutes.post("/discipline/violation/decision", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        id: z.string().min(1).max(250),
        revision,
        status: z.enum(["confirmed", "excused", "reversed"]),
        reason,
      })
      .strict(),
  );
  const source = await c.env.DB.prepare(
    "SELECT * FROM discipline_sources WHERE id=?",
  )
    .bind(i.id)
    .first<ViolationSource>();
  if (!source)
    conflict("This violation no longer applies. Refresh the review queue.");
  await unlocked(c, source.work_date);
  const before = await c.env.DB.prepare(
    "SELECT * FROM violation_decisions WHERE violation_id=?",
  )
    .bind(i.id)
    .first();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO violation_decisions(violation_id,employee_id,work_date,source_token,status,reason,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(violation_id) DO UPDATE SET source_token=excluded.source_token,status=excluded.status,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=excluded.decided_at",
      ).bind(
        i.id,
        source.employee_id,
        source.work_date,
        source.source_token,
        i.status,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "violation.decision", i.id, before, { ...i, source }, i.reason),
      notify(
        c.env.DB,
        `violation:${i.id}:${i.revision}`,
        `Your ${source.category} violation for ${source.work_date} was ${i.status}. Proposed consequences have been recalculated.`,
        source.employee_id,
      ),
    ],
    { ok: true },
  );
});
disciplineRoutes.post("/discipline/early/decision", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        shiftId: z.string().min(1).max(200),
        date,
        revision,
        status: z.enum(["approved", "rejected"]),
        reason,
      })
      .strict(),
  );
  const data = await disciplineSnapshot(c, i.date, null),
    source = data.early.find((e) => e.shiftId === i.shiftId);
  if (!source || source.work_date !== i.date)
    conflict("This early departure no longer applies.");
  if (data.revision !== i.revision) conflict();
  await unlocked(c, i.date);
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO early_departure_reviews(shift_id,employee_id,work_date,source_token,status,reason,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(shift_id) DO UPDATE SET source_token=excluded.source_token,status=excluded.status,reason=excluded.reason,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at",
      ).bind(
        i.shiftId,
        source.employee_id,
        i.date,
        source.sourceToken,
        i.status,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "early.review", i.shiftId, source.review, i, i.reason),
    ],
    { ok: true },
  );
});
disciplineRoutes.post("/discipline/meeting", async (c) => {
  requirePermission(c, "attendance.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({ id: z.string().min(1).max(250), date, revision, reason })
      .strict(),
  );
  const data = await disciplineSnapshot(c, i.date, null),
    v = data.violations.find((v) => v.id === i.id && v.work_date === i.date);
  if (data.revision !== i.revision) conflict();
  if (!v?.meetingRequired || v.meeting)
    conflict("No outstanding manager meeting applies to this violation.");
  await unlocked(c, i.date);
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO manager_meetings(violation_id,employee_id,work_date,progression_token,reason,completed_by,completed_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(violation_id) DO UPDATE SET progression_token=excluded.progression_token,reason=excluded.reason,completed_by=excluded.completed_by,completed_at=excluded.completed_at",
      ).bind(
        v.id,
        v.employee_id,
        v.work_date,
        v.progressionToken,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "meeting.complete", v.id, v.meeting, i, i.reason),
    ],
    { ok: true },
  );
});
const fine = z.number().int().min(0).max(1_000_000_000).nullable();
disciplineRoutes.post("/discipline/policy", async (c) => {
  superAdmin(c);
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        revision,
        effectiveDate: date,
        secondFine: fine,
        thirdFine: fine,
        fourthFine: fine,
        laterFine: fine,
        laterAction: z.string().trim().min(5).max(150),
        reason,
      })
      .strict(),
  );
  const current = await period(c, localDate()),
    target = await period(c, i.effectiveDate);
  if (i.effectiveDate !== target.from || i.effectiveDate < current.from)
    throw new HTTPException(400, {
      message:
        "Policy must start at the beginning of the current or a future payroll month.",
    });
  const { revision: _, effectiveDate, reason: why, ...policy } = i;
  const before = await c.env.DB.prepare(
    "SELECT * FROM disciplinary_policies WHERE effective_date<=? ORDER BY effective_date DESC,id DESC LIMIT 1",
  )
    .bind(effectiveDate)
    .first();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO disciplinary_policies(effective_date,policy_json,created_by,created_at,reason) VALUES(?,?,?,?,?)",
      ).bind(
        effectiveDate,
        JSON.stringify(policy),
        c.get("identity").id,
        now(),
        why,
      ),
      audit(c, "discipline.policy", effectiveDate, before, policy, why),
    ],
    { ok: true },
  );
});
