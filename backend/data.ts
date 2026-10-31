import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./types";
import { sha256 } from "./auth";
import { localDate, type Identity } from "../shared/domain";
export type UserRow = {
  id: string;
  telegram_id: string;
  full_name: string;
  access: Identity["access"];
  active: number;
};
export async function identity(
  db: D1Database,
  user: UserRow,
): Promise<Identity> {
  const { results } = await db
    .prepare(
      "SELECT permission FROM admin_permissions WHERE user_id=? ORDER BY permission",
    )
    .bind(user.id)
    .all<{ permission: Identity["permissions"][number] }>();
  return {
    id: user.id,
    telegramId: user.telegram_id,
    fullName: user.full_name,
    access: user.access,
    permissions: results.map((r) => r.permission),
  };
}
export function audit(
  c: Context<AppEnv>,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  reason?: string,
) {
  return c.env.DB.prepare(
    "INSERT INTO audit_logs(id,actor_id,action,entity_id,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(),
    c.get("identity").id,
    action,
    entityId,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    reason ?? null,
    Math.floor(Date.now() / 1000),
  );
}
export async function mutate(
  c: Context<AppEnv>,
  statements: D1PreparedStatement[],
  result: unknown,
  status: 200 | 201 = 200,
) {
  const actorId = c.get("identity").id,
    key = c.req.header("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new HTTPException(400, {
      message: "A valid Idempotency-Key is required.",
    });
  const fingerprint = await sha256(
    c.req.method + " " + c.req.path + " " + c.get("rawBody"),
  );
  const lookup = () =>
    c.env.DB.prepare(
      "SELECT fingerprint,response_json,status FROM idempotency_keys WHERE actor_id=? AND key=?",
    )
      .bind(actorId, key)
      .first<{
        fingerprint: string;
        response_json: string;
        status: 200 | 201;
      }>();
  const replay = (existing: {
    fingerprint: string;
    response_json: string;
    status: 200 | 201;
  }) => {
    if (existing.fingerprint !== fingerprint)
      throw new HTTPException(409, {
        message: "Idempotency key already used for another operation.",
      });
    return c.json(JSON.parse(existing.response_json), existing.status);
  };
  const existing = await lookup();
  if (existing) return replay(existing);
  try {
    await c.env.DB.batch([
      ...statements,
      c.env.DB.prepare(
        "INSERT INTO idempotency_keys(actor_id,key,fingerprint,response_json,status,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        actorId,
        key,
        fingerprint,
        JSON.stringify(result),
        status,
        Math.floor(Date.now() / 1000),
      ),
    ]);
  } catch (error) {
    const duplicate = await lookup();
    if (duplicate) return replay(duplicate);
    if (
      String(error).includes("ATBOT_CONFLICT") ||
      String(error).includes(
        "NOT NULL constraint failed: attendance_closures.closed_at",
      ) ||
      String(error).includes(
        "NOT NULL constraint failed: attendance_sessions.check_in",
      )
    )
      throw new HTTPException(409, {
        message: "Attendance or registration changed. Refresh and try again.",
      });
    if (String(error).includes("UNIQUE constraint"))
      throw new HTTPException(409, {
        message:
          "A record with this identity, name, or effective date already exists.",
      });
    throw error;
  }
  return c.json(result, status);
}
export async function replayMutation(c: Context<AppEnv>) {
  const key = c.req.header("Idempotency-Key");
  if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new HTTPException(400, {
      message: "A valid Idempotency-Key is required.",
    });
  const row = await c.env.DB.prepare(
    "SELECT fingerprint,response_json,status FROM idempotency_keys WHERE actor_id=? AND key=?",
  )
    .bind(c.get("identity").id, key)
    .first<{ fingerprint: string; response_json: string; status: 200 | 201 }>();
  if (!row) return null;
  if (
    row.fingerprint !==
    (await sha256(c.req.method + " " + c.req.path + " " + c.get("rawBody")))
  )
    throw new HTTPException(409, {
      message: "Idempotency key already used for another operation.",
    });
  return c.json(JSON.parse(row.response_json), row.status);
}
// Evaluate role/rate using the business date, not the most recently inserted record.
export function employeesQuery(own = false) {
  return `SELECT e.id,e.user_id,u.full_name,u.telegram_id,u.access,u.active,e.activation_date,e.deactivation_date,
    h.level_id,l.name AS level_name,r.name AS role_name,r.id AS role_id,
    (SELECT hourly_rate FROM hourly_rate_history WHERE level_id=h.level_id AND effective_date<=? ORDER BY effective_date DESC LIMIT 1) AS hourly_rate
    FROM employees e JOIN users u ON u.id=e.user_id
    LEFT JOIN employee_role_history h ON h.id=(SELECT id FROM employee_role_history WHERE employee_id=e.id AND effective_date<=? ORDER BY effective_date DESC LIMIT 1)
    LEFT JOIN role_levels l ON l.id=h.level_id LEFT JOIN roles r ON r.id=l.role_id
    ${own ? "WHERE u.id=?" : ""} ORDER BY u.full_name,e.id`;
}
export async function activeLevel(
  db: D1Database,
  id: string,
  effectiveDate: string,
) {
  const level = await db
    .prepare(
      `SELECT l.id FROM role_levels l JOIN roles r ON r.id=l.role_id WHERE l.id=? AND l.active=1 AND r.active=1 AND EXISTS(SELECT 1 FROM hourly_rate_history WHERE level_id=l.id AND effective_date<=?)`,
    )
    .bind(id, effectiveDate)
    .first();
  if (!level)
    throw new HTTPException(400, {
      message:
        "Choose an active level with a rate effective on the assignment date.",
    });
}
export function currentOrFuture(date: string) {
  if (date < localDate())
    throw new HTTPException(400, {
      message:
        "Historical changes require a correction workflow; use today or a future date.",
    });
}
