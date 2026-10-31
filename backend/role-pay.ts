import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./types";
import { body, requirePermission, now } from "./http";
import { audit, currentOrFuture, mutate, replayMutation } from "./data";
import { date, reason } from "../shared/validation";

export const rolePayRoutes = new Hono<AppEnv>();
const policySchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      thresholdMinutes: z.number().int().min(1).max(1439),
      hourlyRate: z.number().int().min(0).max(1_000_000_000),
      effectiveDate: date,
      reason,
    })
    .strict(),
  z.object({ enabled: z.literal(false), effectiveDate: date, reason }).strict(),
]);
rolePayRoutes.get("/roles/:id/daily-pay", async (c) => {
  requirePermission(c, "salary.manage");
  const history = (
    await c.env.DB.prepare(
      "SELECT * FROM role_daily_pay_history WHERE role_id=? ORDER BY effective_date DESC,id DESC",
    )
      .bind(c.req.param("id"))
      .all()
  ).results;
  return c.json({ history });
});
rolePayRoutes.post("/roles/:id/daily-pay", async (c) => {
  requirePermission(c, "salary.manage");
  const replay = await replayMutation(c);
  if (replay) return replay;
  const input = await body(c, policySchema),
    id = c.req.param("id");
  currentOrFuture(input.effectiveDate);
  if (
    !(await c.env.DB.prepare("SELECT id FROM roles WHERE id=? AND active=1")
      .bind(id)
      .first())
  )
    throw new HTTPException(404, { message: "Choose an active role." });
  const previous = await c.env.DB.prepare(
    "SELECT * FROM role_daily_pay_history WHERE role_id=? AND effective_date<=? ORDER BY effective_date DESC,id DESC LIMIT 1",
  )
    .bind(id, input.effectiveDate)
    .first();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO role_daily_pay_history(role_id,enabled,threshold_minutes,hourly_rate,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        id,
        Number(input.enabled),
        input.enabled ? input.thresholdMinutes : null,
        input.enabled ? input.hourlyRate : null,
        input.effectiveDate,
        c.get("identity").id,
        now(),
      ),
      audit(c, "role.daily-pay", id, previous, input, input.reason),
    ],
    { ok: true },
    201,
  );
});
