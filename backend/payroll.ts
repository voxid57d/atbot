import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./types";
import {
  body,
  requirePermission,
  superAdmin,
  now,
  type AppContext,
} from "./http";
import { audit, mutate, replayMutation, employeesQuery } from "./data";
import { can, localDate } from "../shared/domain";
import { date, reason } from "../shared/validation";
import { disciplineSnapshot } from "./discipline";
import { historicalRates } from "./attendance";
import {
  payrollEarnings,
  payrollTotals,
  payrollCSV,
  type PayrollAdjustment,
  type PayrollSession,
  type PayrollApproval,
} from "../shared/payroll";
import { dayStart, payrollRange, type Shift } from "../shared/attendance";
import { reviewTask, type ReviewTask } from "../shared/review-tasks";
import { notify } from "./notifications";
import { latestDebt } from "./debtors";
import { DEBTORS_START, debtBonus, type CashierBonus } from "../shared/debtors";
import { roundUZS } from "../shared/attendance";
export const payrollRoutes = new Hono<AppEnv>();
const revision = z.number().int().nonnegative(),
  employeeId = z.string().min(1).max(100),
  amount = z.number().int().min(0).max(1_000_000_000);
const periodInput = { periodDate: date, revision, reason };
type PeriodRow = {
  id: string;
  from_date: string;
  to_date: string;
  status: string;
  snapshot_version: number;
};
type Adjustment = PayrollAdjustment & {
  employee_id: string;
  created_by: string;
  decided_by: string | null;
  decision_reason: string | null;
};
type Fine = {
  violation_id: string;
  employee_id: string;
  work_date: string;
  progression_token: string;
  status: string;
  amount: number;
  reason: string;
  decided_by: string;
  decided_at: number;
  decided_by_name: string | null;
};
type Resolution = {
  employee_id: string;
  work_date: string;
  kind: string;
  source_token: string;
  reason: string;
};
type Warning = ReviewTask & {
  sourceToken?: string;
};
type PayrollViolation = Awaited<
  ReturnType<typeof disciplineSnapshot>
>["violations"][number] & { fineDecision: Fine | null };
export type PayrollEntry = ReturnType<typeof payrollEarnings> &
  ReturnType<typeof payrollTotals> & {
    employeeId: string;
    fullName: string;
    role: string | null;
    level: string | null;
    adjustments: Adjustment[];
    violations: PayrollViolation[];
    cashierBonus: CashierBonus | null;
  };
type Draft = {
  id: string;
  period: { from: string; to: string };
  status: "open" | "finalized";
  snapshotVersion: number;
  revision: number;
  entries: PayrollEntry[];
  warnings: Warning[];
  totalPay: number;
  adjustments: Adjustment[];
  fineDecisions: Fine[];
  payrollStartDay: number;
  generatedAt: number;
  calculationVersion: number;
};
function conflict(
  message = "Payroll inputs changed. Refresh and try again.",
): never {
  throw new HTTPException(409, { message });
}
function guard(c: AppContext, r: number) {
  return c.env.DB.prepare(
    "UPDATE discipline_state SET revision=? WHERE id=1",
  ).bind(r + 1);
}
function viewPermission(c: AppContext) {
  const u = c.get("identity");
  if (!can(u, "salary.manage") && !can(u, "payroll.approve"))
    throw new HTTPException(403, {
      message: "Salary or payroll administrator permission required.",
    });
}
function proposePermission(c: AppContext) {
  const u = c.get("identity");
  if (!can(u, "salary.manage") && !can(u, "payroll.approve"))
    throw new HTTPException(403, {
      message: "Salary or payroll permission required.",
    });
}
async function own(c: AppContext) {
  const e = await c.env.DB.prepare("SELECT id FROM employees WHERE user_id=?")
    .bind(c.get("identity").id)
    .first<{ id: string }>();
  if (!e)
    throw new HTTPException(403, {
      message: "An employee profile is required.",
    });
  return e.id;
}
async function openDate(c: AppContext, d: string) {
  if (
    await c.env.DB.prepare(
      "SELECT id FROM payroll_period_locks WHERE ? BETWEEN from_date AND to_date",
    )
      .bind(d)
      .first()
  )
    conflict(
      "Payroll is locked. Reopen it with an audited reason before making corrections.",
    );
}
export async function payrollPreview(
  c: AppContext,
  periodDate: string,
): Promise<Draft> {
  const settings = await c.env.DB.prepare(
    "SELECT payroll_start_day FROM system_settings WHERE id=1",
  ).first<{ payroll_start_day: number }>();
  const selected = payrollRange(periodDate, settings!.payroll_start_day),
    selectedId = `payroll:${selected.from}:${selected.to}`;
  const finalized = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT s.payload_json,p.snapshot_version FROM payroll_periods p JOIN payroll_snapshots s ON s.period_id=p.id AND s.version=p.snapshot_version WHERE p.id=? AND p.status='finalized'",
    ).bind(selectedId),
    c.env.DB.prepare("SELECT revision FROM discipline_state WHERE id=1"),
  ]);
  if (finalized[0].results.length) {
    const row = finalized[0].results[0] as {
      payload_json: string;
      snapshot_version: number;
    };
    return {
      ...(JSON.parse(row.payload_json) as Draft),
      status: "finalized",
      snapshotVersion: row.snapshot_version,
      revision: (finalized[1].results[0] as { revision: number }).revision,
    };
  }
  const discipline = await disciplineSnapshot(c, periodDate, null),
    p = discipline.period;
  const id = `payroll:${p.from}:${p.to}`;
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM payroll_periods WHERE id=?").bind(id),
    c.env.DB.prepare(
      "SELECT * FROM payroll_adjustments WHERE work_date BETWEEN ? AND ? ORDER BY created_at,id",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT f.*,u.full_name AS decided_by_name FROM payroll_fine_decisions f LEFT JOIN users u ON u.id=f.decided_by WHERE f.work_date BETWEEN ? AND ?",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT * FROM payroll_resolutions WHERE work_date BETWEEN ? AND ?",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT * FROM effective_attendance WHERE work_date BETWEEN ? AND ? ORDER BY id",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT * FROM scheduled_shifts WHERE work_date BETWEEN ? AND ? ORDER BY id",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT * FROM overtime_approvals WHERE work_date BETWEEN ? AND ? ORDER BY id",
    ).bind(p.from, p.to),
    c.env.DB.prepare(
      "SELECT * FROM employee_requests WHERE work_date BETWEEN ? AND ? AND kind='absence' AND status='approved'",
    ).bind(p.from, p.to),
    c.env.DB.prepare(employeesQuery()).bind(p.to, p.to),
  ]);
  const state = (results[0].results[0] as PeriodRow | undefined) ?? null;
  if (state?.status === "finalized") {
    const row = await c.env.DB.prepare(
      "SELECT payload_json FROM payroll_snapshots WHERE period_id=? AND version=?",
    )
      .bind(id, state.snapshot_version)
      .first<{ payload_json: string }>();
    return {
      ...(JSON.parse(row!.payload_json) as Draft),
      status: "finalized" as const,
      snapshotVersion: state.snapshot_version,
      revision: discipline.revision,
    };
  }
  const adjustments = results[1].results as unknown as Adjustment[],
    fines = results[2].results as unknown as Fine[],
    resolutions = results[3].results as unknown as Resolution[];
  const sessions = results[4].results as unknown as (PayrollSession & {
      employee_id: string;
    })[],
    shifts = results[5].results as unknown as (Shift & {
      employee_id: string;
    })[],
    approvals = results[6].results as unknown as (PayrollApproval & {
      employee_id: string;
    })[];
  const absences = results[7].results as unknown as {
    employee_id: string;
    work_date: string;
    paid: number;
  }[];
  const people = results[8].results as unknown as {
    id: string;
    full_name: string;
    activation_date: string;
    deactivation_date: string | null;
    role_name: string | null;
    level_name: string | null;
  }[];
  const warnings: Warning[] = [];
  const entries: PayrollEntry[] = [];
  const debtEntry = p.to >= DEBTORS_START ? await latestDebt(c, p.to) : null;
  const assignments = (await c.env.DB.prepare(`SELECT h.employee_id,h.effective_date,l.role_id
    FROM employee_role_history h JOIN role_levels l ON l.id=h.level_id
    WHERE h.effective_date<=? ORDER BY h.effective_date`).bind(p.to)
    .all<{ employee_id: string; effective_date: string; role_id: string }>()).results;
  for (const person of people) {
    const es = sessions.filter((s) => s.employee_id === person.id),
      ss = shifts.filter((s) => s.employee_id === person.id),
      ea = adjustments.filter((a) => a.employee_id === person.id),
      eo = approvals.filter((a) => a.employee_id === person.id);
    if (person.activation_date > p.to && !es.length && !ea.length) continue;
    if (
      person.deactivation_date &&
      person.deactivation_date <= p.from &&
      !es.length &&
      !ea.length
    )
      continue;
    const rates = await historicalRates(c, person.id, p.to),
      earn = payrollEarnings(p.from, p.to, es, ss, eo, rates);
    warnings.push(...discipline.tasks.filter((task) => task.employeeId === person.id));
    const violations = discipline.violations
      .filter((v) => v.employee_id === person.id)
      .map((v) => ({
        ...v,
        fineDecision:
          fines.find(
            (f) =>
              f.violation_id === v.id &&
              f.progression_token === v.progressionToken,
          ) ?? null,
      }));
    // The feature starts in October, but the multiplier covers that whole month's
    // earnings on days assigned as cashier, including days before its launch.
    const cashierDays = p.to >= DEBTORS_START ? earn.days.filter((day) => assignments
      .filter((a) => a.employee_id === person.id && a.effective_date <= day.date)
      .at(-1)?.role_id === "cashier") : [];
    const eligibleEarnings = roundUZS(cashierDays.reduce((n, day) =>
      n + BigInt(day.regularNumerator) + BigInt(day.overtimeNumerator), 0n));
    const cashierBonus = cashierDays.length ? debtBonus(eligibleEarnings, debtEntry) : null;
    const totals = payrollTotals(
      earn.workedGross,
      ea,
      violations
        .filter((v) => v.ordinal > 0 && v.fineDecision?.status === "approved")
        .map((v) => v.fineDecision!.amount),
    );
    if (cashierBonus) {
      totals.bonuses += cashierBonus.amount;
      totals.finalPay += cashierBonus.amount;
      if (!Number.isSafeInteger(totals.finalPay)) throw new Error("Salary exceeds the supported integer range");
    }
    const warn = (
      kind: string,
      message: string,
      d = p.from,
      sourceToken?: string,
      subjectId = d,
    ) =>
      warnings.push({
        ...reviewTask(person.id, d, kind, message, subjectId, sourceToken),
        ...(sourceToken ? { sourceToken } : {}),
      });
    if (eligibleEarnings > 0 && !debtEntry)
      warn("missing_debt_entry", "Enter shared debtor counts before finalizing cashier bonuses.", p.to);
    for (const d of earn.days) {
      if (d.unratedSeconds)
        warn(
          "missing_rate",
          "Credited attendance has no historical hourly rate.",
          d.date,
        );
      if (d.pendingPaidSeconds) {
        const token = JSON.stringify([
          es.filter((s) => s.work_date === d.date),
          ss.filter((s) => s.work_date === d.date),
          eo.filter((a) => a.work_date === d.date),
        ]);
        if (
          !resolutions.some(
            (r) =>
              r.employee_id === person.id &&
              r.work_date === d.date &&
              r.kind === "unapproved_overtime" &&
              r.source_token === token,
          )
        )
          warn(
            "unapproved_overtime",
            "Approve overtime through attendance, or explicitly exclude it from pay.",
            d.date,
            token,
          );
      }
      if (
        d.date <= localDate() &&
        ss.some(
          (s) =>
            s.work_date === d.date &&
            s.kind === "regular" &&
            s.status === "scheduled",
        ) &&
        ss.filter((s) => s.work_date === d.date && s.kind === "regular" && s.status === "scheduled")
          .every((s) => s.end_at <= now()) &&
        !es.some((s) => s.work_date === d.date) &&
        !absences.some(
          (a) => a.employee_id === person.id && a.work_date === d.date,
        )
      ) {
        const token = JSON.stringify(ss.filter((s) => s.work_date === d.date));
        if (
          !resolutions.some(
            (r) =>
              r.employee_id === person.id &&
              r.work_date === d.date &&
              r.kind === "unworked_day" &&
              r.source_token === token,
          )
        )
          warn(
            "unworked_day",
            "Scheduled day has no attendance or approved absence. Resolve it or explicitly confirm no worked time.",
            d.date,
            token,
          );
      }
    }
    for (const a of absences.filter(
      (a) => a.employee_id === person.id && a.paid,
    ))
      if (
        !ea.some(
          (e) =>
            e.kind === "leave_pay" &&
            e.work_date === a.work_date &&
            e.status === "approved",
        )
      )
        warn(
          "paid_leave",
          "Paid absence requires a manually entered and approved leave-pay adjustment.",
          a.work_date,
        );
    for (const a of ea.filter((a) => a.status === "pending"))
      warn(
        "pending_adjustment",
        "Approve or reject the pending adjustment.",
        a.work_date,
        undefined,
        a.id,
      );
    for (const s of es)
      if (
        s.check_out !== null &&
        (s.check_out > dayStart(s.work_date) + 86400 ||
          s.check_out - s.check_in > 18 * 3600)
      )
        warn(
          "invalid_session",
          "Correct the attendance session exceeding its workday or 18-hour limit.",
          s.work_date,
        );
    if (totals.finalPay < 0)
      warn(
        "negative_pay",
        "Deductions exceed earnings. Correct the approved adjustments before finalization.",
      );
    entries.push({
      employeeId: person.id,
      fullName: person.full_name,
      role: person.role_name,
      level: person.level_name,
      ...earn,
      days: earn.days.map((day) => ({
        ...day,
        shifts: ss
          .filter((s) => s.work_date === day.date)
          .map((s) => ({
            id: s.id,
            start_at: s.start_at,
            end_at: s.end_at,
            kind: s.kind,
            status: s.status,
          })),
        sessions: es
          .filter((s) => s.work_date === day.date)
          .map((s) => ({
            id: s.id,
            check_in: s.check_in,
            check_out: s.check_out,
          })),
      })),
      ...totals,
      cashierBonus,
      adjustments: ea,
      violations,
    });
  }
  const endRevision = (await c.env.DB.prepare(
    "SELECT revision FROM discipline_state WHERE id=1",
  ).first<{ revision: number }>())!.revision;
  if (endRevision !== discipline.revision) conflict();
  return {
    id,
    period: p,
    status: "open" as const,
    snapshotVersion: state?.snapshot_version ?? 0,
    revision: endRevision,
    entries,
    warnings,
    totalPay: entries.reduce((s, e) => s + e.finalPay, 0),
    adjustments,
    fineDecisions: fines,
    payrollStartDay: Number(p.from.slice(8)),
    generatedAt: now(),
    calculationVersion: 5,
  };
}
payrollRoutes.get("/payroll/preview", async (c) => {
  viewPermission(c);
  const preview = await payrollPreview(
    c,
    date.parse(c.req.query("periodDate") ?? localDate()),
  );
  const disabled = await c.env.DB.prepare(
    "SELECT e.id FROM employees e JOIN users u ON u.id=e.user_id WHERE u.active=0",
  ).all<{ id: string }>();
  return c.json({
    ...preview,
    disabledEmployeeIds: disabled.results.map((e) => e.id),
  });
});
payrollRoutes.post("/payroll/adjustments", async (c) => {
  proposePermission(c);
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        employeeId,
        date,
        kind: z.enum(["bonus", "deduction", "leave_pay"]),
        amount,
        reason,
        revision,
      })
      .strict(),
  );
  await openDate(c, i.date);
  if (
    !(await c.env.DB.prepare(
      "SELECT id FROM employees WHERE id=? AND activation_date<=?",
    )
      .bind(i.employeeId, i.date)
      .first())
  )
    throw new HTTPException(400, {
      message: "Choose an employee employed on or before the adjustment date.",
    });
  if (
    i.kind === "leave_pay" &&
    !(await c.env.DB.prepare(
      "SELECT id FROM employee_requests WHERE employee_id=? AND work_date=? AND kind='absence' AND status='approved' AND paid=1",
    )
      .bind(i.employeeId, i.date)
      .first())
  )
    throw new HTTPException(400, {
      message:
        "Leave pay must reference an approved paid absence on that date.",
    });
  const id = crypto.randomUUID();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO payroll_adjustments(id,employee_id,work_date,kind,amount,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        i.employeeId,
        i.date,
        i.kind,
        i.amount,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "payroll.adjustment.propose", id, null, i, i.reason),
    ],
    { id },
    201,
  );
});
payrollRoutes.post("/payroll/adjustments/:id/decision", async (c) => {
  requirePermission(c, "payroll.approve");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
      c,
      z
        .object({
          status: z.enum(["approved", "rejected", "reversed"]),
          revision,
          reason,
        })
        .strict(),
    ),
    id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT * FROM payroll_adjustments WHERE id=?",
  )
    .bind(id)
    .first<Adjustment>();
  if (!before)
    throw new HTTPException(404, { message: "Adjustment not found." });
  await openDate(c, before.work_date);
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "UPDATE payroll_adjustments SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE id=?",
      ).bind(i.status, c.get("identity").id, now(), i.reason, id),
      audit(c, "payroll.adjustment.decision", id, before, i, i.reason),
    ],
    { ok: true },
  );
});
payrollRoutes.post("/payroll/fines/decision", async (c) => {
  requirePermission(c, "payroll.approve");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        id: z.string().min(1).max(250),
        ...periodInput,
        status: z.enum(["approved", "rejected"]),
        amount,
      })
      .strict(),
  );
  const d = await payrollPreview(c, i.periodDate);
  if (d.status !== "open" || d.revision !== i.revision) conflict();
  const v = d.entries.flatMap((e) => e.violations).find((v) => v.id === i.id);
  if (
    !v ||
    !v.ordinal ||
    v.status === "detected" ||
    v.proposedFine === null ||
    i.amount > v.proposedFine ||
    (i.status === "rejected" && i.amount !== 0)
  )
    throw new HTTPException(400, {
      message:
        "Confirm the violation and configure its proposal first. Approved amount cannot exceed the proposal; rejected fines must be zero.",
    });
  const before = await c.env.DB.prepare(
    "SELECT * FROM payroll_fine_decisions WHERE violation_id=?",
  )
    .bind(i.id)
    .first();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO payroll_fine_decisions(violation_id,employee_id,work_date,progression_token,status,amount,reason,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(violation_id) DO UPDATE SET progression_token=excluded.progression_token,status=excluded.status,amount=excluded.amount,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=excluded.decided_at",
      ).bind(
        v.id,
        v.employee_id,
        v.work_date,
        v.progressionToken,
        i.status,
        i.amount,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(c, "payroll.fine.decision", v.id, before, i, i.reason),
    ],
    { ok: true },
  );
});
payrollRoutes.post("/payroll/resolutions", async (c) => {
  requirePermission(c, "payroll.approve");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z
      .object({
        ...periodInput,
        employeeId,
        date,
        kind: z.enum(["unapproved_overtime", "unworked_day"]),
      })
      .strict(),
  );
  const d = await payrollPreview(c, i.periodDate);
  if (d.status !== "open" || d.revision !== i.revision) conflict();
  const w = d.warnings.find(
    (w) =>
      w.employeeId === i.employeeId && w.date === i.date && w.kind === i.kind,
  );
  if (!w?.sourceToken)
    conflict("The attendance issue no longer requires this resolution.");
  await openDate(c, i.date);
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO payroll_resolutions(employee_id,work_date,kind,source_token,reason,decided_by,decided_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(employee_id,work_date,kind) DO UPDATE SET source_token=excluded.source_token,reason=excluded.reason,decided_by=excluded.decided_by,decided_at=excluded.decided_at",
      ).bind(
        i.employeeId,
        i.date,
        i.kind,
        w.sourceToken,
        i.reason,
        c.get("identity").id,
        now(),
      ),
      audit(
        c,
        "payroll.attendance.resolve",
        `${i.employeeId}:${i.date}:${i.kind}`,
        null,
        i,
        i.reason,
      ),
    ],
    { ok: true },
  );
});
payrollRoutes.post("/payroll/finalize", async (c) => {
  requirePermission(c, "payroll.approve");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, z.object(periodInput).strict()),
    d = await payrollPreview(c, i.periodDate);
  if (d.status !== "open" || d.revision !== i.revision) conflict();
  if (d.period.to >= localDate())
    throw new HTTPException(400, {
      message: "Finalize only after the payroll period has ended.",
    });
  if (d.entries.some((e) => e.days.some((day) => day.openSessions)))
    conflict("Close all attendance sessions in this period before finalizing payroll.");
  if (d.warnings.length || !d.entries.length)
    conflict(
      "Resolve all payroll warnings and include at least one employee before finalizing.",
    );
  const version = d.snapshotVersion + 1,
    payload = {
      ...d,
      status: "finalized",
      snapshotVersion: version,
      approvedBy: c.get("identity").id,
      approvedAt: now(),
      approvalReason: i.reason,
    };
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "INSERT INTO payroll_periods(id,from_date,to_date,status,snapshot_version,approved_by,approved_at) VALUES(?,?,?,'finalized',?,?,?) ON CONFLICT(id) DO UPDATE SET status='finalized',snapshot_version=excluded.snapshot_version,approved_by=excluded.approved_by,approved_at=excluded.approved_at,reopen_reason=NULL",
      ).bind(
        d.id,
        d.period.from,
        d.period.to,
        version,
        c.get("identity").id,
        now(),
      ),
      c.env.DB.prepare(
        "INSERT INTO payroll_snapshots(period_id,version,payload_json,approved_by,approved_at,reason) VALUES(?,?,?,?,?,?)",
      ).bind(
        d.id,
        version,
        JSON.stringify(payload),
        c.get("identity").id,
        now(),
        i.reason,
      ),
      c.env.DB.prepare(
        "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES(?,?,?,?,?)",
      ).bind(d.id, d.period.from, d.period.to, c.get("identity").id, now()),
      audit(
        c,
        "payroll.finalize",
        d.id,
        null,
        { version, totalPay: d.totalPay, period: d.period },
        i.reason,
      ),
      ...d.entries.map((e) =>
        notify(
          c.env.DB,
          `payroll-finalized:${d.id}:${version}`,
          `Payroll for ${d.period.from} to ${d.period.to} is finalized. Open Salary history for your breakdown.`,
          e.employeeId,
        ),
      ),
    ],
    { ok: true, version },
  );
});
payrollRoutes.post("/payroll/reopen", async (c) => {
  requirePermission(c, "payroll.approve");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(c, z.object(periodInput).strict()),
    d = await payrollPreview(c, i.periodDate);
  if (d.status !== "finalized" || d.revision !== i.revision) conflict();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "UPDATE payroll_periods SET status='open',reopen_reason=? WHERE id=? AND status='finalized'",
      ).bind(i.reason, d.id),
      c.env.DB.prepare("DELETE FROM payroll_period_locks WHERE id=?").bind(
        d.id,
      ),
      audit(
        c,
        "payroll.reopen",
        d.id,
        { version: d.snapshotVersion, status: d.status },
        i,
        i.reason,
      ),
    ],
    { ok: true },
  );
});
// Only the authenticated employee's monthly figures leave this endpoint.
payrollRoutes.get("/payroll/mine", async (c) => {
  const id = await own(c);
  const selected = date.parse(c.req.query("periodDate") ?? localDate());
  const draft = await payrollPreview(c, selected);
  return c.json({
    period: draft.period,
    status: draft.status,
    entry: draft.entries.find((e) => e.employeeId === id) ?? null,
    warnings: draft.warnings.filter((w) => w.employeeId === id),
    generatedAt: draft.generatedAt,
  });
});
payrollRoutes.get("/payroll/history", async (c) => {
  const id = await own(c);
  const rows = (
    await c.env.DB.prepare(
      "SELECT s.*,p.status AS period_status,p.snapshot_version AS current_version FROM payroll_snapshots s JOIN payroll_periods p ON p.id=s.period_id ORDER BY p.from_date DESC,s.version DESC",
    ).all<{
      period_id: string;
      version: number;
      payload_json: string;
      approved_at: number;
      period_status: string;
      current_version: number;
    }>()
  ).results;
  return c.json({
    snapshots: rows.flatMap((r) => {
      const payload = JSON.parse(r.payload_json) as Draft;
      const entry = payload.entries.find((e) => e.employeeId === id);
      return entry
        ? [
            {
              periodId: r.period_id,
              version: r.version,
              period: payload.period,
              approvedAt: r.approved_at,
              periodStatus: r.period_status,
              isCurrent: r.version === r.current_version,
              entry,
            },
          ]
        : [];
    }),
  });
});
payrollRoutes.get("/payroll/export", async (c) => {
  viewPermission(c);
  const d = await payrollPreview(
    c,
    date.parse(c.req.query("periodDate") ?? localDate()),
  );
  if (d.status !== "finalized")
    conflict("CSV export is available for finalized payroll only.");
  return new Response(payrollCSV(d.entries, d.period), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ielts-zone-payroll-${d.period.from}-v${d.snapshotVersion}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
payrollRoutes.get("/payroll/settings", async (c) => {
  viewPermission(c);
  return c.json(
    await c.env.DB.prepare(
      "SELECT payroll_start_day FROM system_settings WHERE id=1",
    ).first(),
  );
});
payrollRoutes.post("/payroll/settings", async (c) => {
  superAdmin(c);
  const replay = await replayMutation(c);
  if (replay) return replay;
  const i = await body(
    c,
    z.object({ firstDay: z.literal(1), revision, reason }).strict(),
  );
  if (
    (await c.env.DB.prepare(
      "SELECT id FROM payroll_periods WHERE snapshot_version>0 LIMIT 1",
    ).first()) ||
    (await c.env.DB.prepare(
      "SELECT id FROM disciplinary_policies WHERE id>1 LIMIT 1",
    ).first())
  )
    conflict(
      "Payroll-month boundaries cannot change after a finalized snapshot or a configured discipline policy.",
    );
  const before = await c.env.DB.prepare(
    "SELECT payroll_start_day FROM system_settings WHERE id=1",
  ).first();
  return mutate(
    c,
    [
      guard(c, i.revision),
      c.env.DB.prepare(
        "UPDATE system_settings SET payroll_start_day=? WHERE id=1",
      ).bind(i.firstDay),
      audit(c, "payroll.settings", "1", before, i, i.reason),
    ],
    { ok: true },
  );
});
