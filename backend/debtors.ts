import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./types";
import { body, now, type AppContext } from "./http";
import { audit, mutate, replayMutation } from "./data";
import { localDate } from "../shared/domain";
import { DEBTORS_START, debtResult, type DebtEntry } from "../shared/debtors";
export const debtorsRoutes = new Hono<AppEnv>();
async function access(c: AppContext) {
  if (c.get("identity").access !== "employee") return;
  const cashier = await c.env.DB.prepare(`SELECT e.id FROM employees e
    JOIN employee_role_history h ON h.id=(SELECT id FROM employee_role_history WHERE employee_id=e.id AND effective_date<=? ORDER BY effective_date DESC LIMIT 1)
    JOIN role_levels l ON l.id=h.level_id
    WHERE e.user_id=? AND l.role_id='cashier' AND e.activation_date<=? AND (e.deactivation_date IS NULL OR e.deactivation_date>?)`)
    .bind(localDate(), c.get("identity").id, localDate(), localDate()).first();
  if (!cashier) throw new HTTPException(403, { message: "Cashier or administrator access required." });
}
export async function latestDebt(c: AppContext, to: string) {
  return c.env.DB.prepare("SELECT id,work_date,d1,d2,d3,d4,s1,s2,s3,created_at FROM debtor_entries WHERE work_date BETWEEN ? AND ? AND work_date<=? ORDER BY id DESC LIMIT 1")
    .bind(DEBTORS_START, to, localDate()).first<DebtEntry>();
}
debtorsRoutes.get("/debtors", async (c) => {
  await access(c);
  const today = localDate(), from = today.slice(0, 7) + "-01";
  const results = await c.env.DB.batch([
    // Keep every write for audit, but expose only the last saved entry of each day.
    c.env.DB.prepare(`SELECT id,work_date,d1,d2,d3,d4,s1,s2,s3,created_at FROM debtor_entries
      WHERE id IN (SELECT MAX(id) FROM debtor_entries WHERE work_date BETWEEN ? AND ? GROUP BY work_date)
      OR id=(SELECT id FROM debtor_entries WHERE work_date<? ORDER BY id DESC LIMIT 1)
      ORDER BY id DESC`).bind(from, today, from),
    c.env.DB.prepare("SELECT revision FROM discipline_state WHERE id=1"),
    c.env.DB.prepare("SELECT id FROM payroll_period_locks WHERE ? BETWEEN from_date AND to_date").bind(today),
  ]);
  return c.json({ today, effectiveDate: DEBTORS_START, history: results[0].results,
    revision: (results[1].results[0] as { revision: number }).revision,
    locked: results[2].results.length > 0 });
});
const count = z.number().int().min(0).max(10_000_000);
debtorsRoutes.post("/debtors", async (c) => {
  await access(c);
  const replay = await replayMutation(c);
  if (replay) return replay;
  const input = await body(c, z.object({ d1: count, d2: count, d3: count, d4: count,
    s1: count, s2: count, s3: count, revision: z.number().int().nonnegative() }).strict());
  const today = localDate();
  if (today < DEBTORS_START) throw new HTTPException(400, { message: "Debt bonuses start on 15 October 2026." });
  if (!debtResult(input)) throw new HTTPException(400, { message: "Enter at least one student." });
  return mutate(c, [
    // Existing revision guard rejects stale or concurrent writes atomically.
    c.env.DB.prepare("UPDATE discipline_state SET revision=? WHERE id=1").bind(input.revision + 1),
    c.env.DB.prepare("INSERT INTO debtor_entries(work_date,d1,d2,d3,d4,s1,s2,s3,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(today,input.d1,input.d2,input.d3,input.d4,input.s1,input.s2,input.s3,c.get("identity").id,now()),
    audit(c, "debtors.record", today, null, input),
  ], { ok: true }, 201);
});
