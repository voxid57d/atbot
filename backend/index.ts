import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import {
  body,
  requirePermission,
  superAdmin,
  isLocal as isLocalDevelopment,
} from "./http";
import { tabletPublic } from "./qr";
import { attendanceRoutes } from "./attendance";
import { requestRoutes } from "./requests";
import { disciplineRoutes } from "./discipline";
import { payrollRoutes } from "./payroll";
import { debtorsRoutes } from "./debtors";
import { rolePayRoutes } from "./role-pay";
import {
  telegramPublic,
  notificationRoutes,
  scheduledNotifications,
} from "./notifications";
import type { AppEnv } from "./types";
import { sha256, verifyTelegram } from "./auth";
import { can, localDate } from "../shared/domain";
import {
  loginSchema,
  employeeSchema,
  employeeUpdateSchema,
  linkSchema,
  roleSchema,
  levelSchema,
  rateSchema,
  catalogUpdateSchema,
  accessSchema,
  deleteEmployeeSchema,
} from "../shared/validation";
import {
  identity,
  audit,
  mutate,
  employeesQuery,
  activeLevel,
  currentOrFuture,
  type UserRow,
} from "./data";
const app = new Hono<AppEnv>();
const seconds = () => Math.floor(Date.now() / 1000);
const cookieName = (c: Parameters<typeof audit>[0]) =>
  isLocalDevelopment(c) ? "atbot_session" : "__Host-atbot_session";
// Apply private-response headers even when body validation rejects a request.
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!isLocalDevelopment(c))
    c.header("Strict-Transport-Security", "max-age=31536000");
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 16384,
    onError: (c) => c.json({ error: "Request is too large." }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  if (!isLocalDevelopment(c) && new URL(c.req.url).protocol !== "https:")
    throw new HTTPException(400, { message: "HTTPS is required." });
  if (c.req.path === "/api/telegram/webhook" && c.req.method === "POST") {
    await next();
    return;
  }
  if (!["GET", "HEAD"].includes(c.req.method)) {
    if (c.req.header("Origin") !== c.env.APP_ORIGIN)
      throw new HTTPException(403, {
        message: "Request origin is not allowed.",
      });
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      throw new HTTPException(415, { message: "Use application/json." });
    if (Number(c.req.header("Content-Length") ?? 0) > 16384)
      throw new HTTPException(413, { message: "Request is too large." });
    const raw = await c.req.text();
    if (raw.length > 16384)
      throw new HTTPException(413, { message: "Request is too large." });
    c.set("rawBody", raw);
    const ip = c.req.header("CF-Connecting-IP") ?? "local";
    const key = await sha256(
        `${ip}:${c.req.path === "/api/auth/telegram" ? "login" : "write"}`,
      ),
      windowStart = Math.floor(seconds() / 60) * 60;
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count`,
    )
      .bind(key, windowStart)
      .first<{ count: number }>();
    if (
      (row?.count ?? 1000) > (c.req.path === "/api/auth/telegram" ? 20 : 100)
    ) {
      c.header("Retry-After", "60");
      throw new HTTPException(429, {
        message: "Too many requests. Try again in one minute.",
      });
    }
  }
  await next();
});
app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT id FROM system_settings WHERE id=1").first();
  await c.env.DB.prepare("SELECT id FROM registered_tablets LIMIT 1").first();
  await c.env.DB.prepare("SELECT id FROM employee_requests LIMIT 1").first();
  await c.env.DB.prepare("SELECT id FROM discipline_state WHERE id=1").first();
  await c.env.DB.prepare("SELECT id FROM payroll_periods LIMIT 1").first();
  await c.env.DB.prepare("SELECT id FROM debtor_entries LIMIT 1").first();
  await c.env.DB.prepare(
    "SELECT version FROM payroll_snapshots LIMIT 1",
  ).first();
  await c.env.DB.prepare(
    "SELECT id FROM role_daily_pay_history LIMIT 1",
  ).first();
  await c.env.DB.prepare(
    "SELECT encouragement FROM telegram_chats LIMIT 1",
  ).first();
  await c.env.DB.prepare(
    "SELECT shift_id,expires_at FROM notification_outbox LIMIT 1",
  ).first();
  return c.json({ status: "ok", phase: 6 });
});
app.post("/api/auth/telegram", async (c) => {
  if (
    !c.env.TELEGRAM_BOT_TOKEN ||
    !c.env.APP_ORIGIN ||
    c.env.APP_ORIGIN.includes("replace-before-deployment")
  )
    throw new HTTPException(503, {
      message: "Authentication has not been configured.",
    });
  const { initData } = await body(c, loginSchema);
  const previousToken = getCookie(c, cookieName(c));
  const revokePrevious = async () => {
    if (previousToken)
      await c.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
        .bind(await sha256(previousToken))
        .run();
    deleteCookie(c, cookieName(c), {
      path: "/",
      secure: !isLocalDevelopment(c),
    });
  };
  let verified: Awaited<ReturnType<typeof verifyTelegram>>;
  try {
    // A matching live cookie can resume an already verified launch for its session lifetime.
    verified = await verifyTelegram(
      initData,
      c.env.TELEGRAM_BOT_TOKEN,
      seconds(),
      43200,
    );
  } catch (error) {
    await revokePrevious();
    throw error;
  }
  const previousSession = previousToken
    ? await c.env.DB.prepare(
        "SELECT u.telegram_id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
      )
        .bind(await sha256(previousToken), seconds())
        .first<{ telegram_id: string }>()
    : null;
  const resume = previousSession?.telegram_id === verified.telegramId;
  if (!resume) {
    await revokePrevious();
    // Establishing a new identity always requires the original five-minute freshness check.
    await verifyTelegram(initData, c.env.TELEGRAM_BOT_TOKEN);
  }
  let user = await c.env.DB.prepare("SELECT * FROM users WHERE telegram_id=?")
    .bind(verified.telegramId)
    .first<UserRow>();
  if (!user && verified.telegramId === c.env.BOOTSTRAP_TELEGRAM_ID) {
    const id = crypto.randomUUID(),
      now = seconds();
    if (
      !(await c.env.DB.prepare(
        "SELECT id FROM bootstrap_state WHERE id=1",
      ).first())
    ) {
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            "INSERT INTO users(id,telegram_id,full_name,access,created_at,updated_at) VALUES(?,?,?,'super_admin',?,?)",
          ).bind(id, verified.telegramId, verified.fullName, now, now),
          c.env.DB.prepare(
            "INSERT INTO bootstrap_state(id,user_id,created_at) VALUES(1,?,?)",
          ).bind(id, now),
          c.env.DB.prepare(
            "INSERT INTO audit_logs(id,actor_id,action,entity_id,after_json,created_at) VALUES(?,?,'bootstrap',?,?,?)",
          ).bind(
            crypto.randomUUID(),
            id,
            id,
            JSON.stringify({ telegramId: verified.telegramId }),
            now,
          ),
        ]);
      } catch (error) {
        if (!String(error).includes("UNIQUE constraint")) throw error;
      }
      user = await c.env.DB.prepare("SELECT * FROM users WHERE telegram_id=?")
        .bind(verified.telegramId)
        .first<UserRow>();
    }
  }
  if (!user)
    throw new HTTPException(403, {
      message:
        "Your Telegram account is not registered. Contact your administrator.",
    });
  if (!user.active)
    throw new HTTPException(403, { message: "Your account is disabled." });
  const employment = await c.env.DB.prepare(
    "SELECT activation_date,deactivation_date FROM employees WHERE user_id=?",
  )
    .bind(user.id)
    .first<{ activation_date: string; deactivation_date: string | null }>();
  if (
    user.access === "employee" &&
    (!employment ||
      employment.activation_date > localDate() ||
      (employment.deactivation_date !== null &&
        employment.deactivation_date <= localDate()))
  )
    throw new HTTPException(403, {
      message: "Your employment is not currently active.",
    });
  if (resume) return c.json({ user: await identity(c.env.DB, user) });
  const token = crypto.randomUUID() + crypto.randomUUID(),
    tokenHash = await sha256(token),
    now = seconds();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM consumed_logins WHERE expires_at<?").bind(
        now,
      ),
      c.env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<?").bind(
        now,
      ),
      c.env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?").bind(
        now - 3600,
      ),
      c.env.DB.prepare(
        "INSERT INTO consumed_logins(hash,expires_at) VALUES(?,?)",
      ).bind(verified.loginHash, verified.expiresAt),
      c.env.DB.prepare(
        "INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
      ).bind(tokenHash, user.id, now, now + 43200),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint"))
      throw new HTTPException(409, {
        message:
          "This Telegram login has already been used. Reopen the Mini App.",
      });
    throw error;
  }
  // Replace a pending cookie deletion with the new account's single session cookie.
  c.header("Set-Cookie", undefined);
  setCookie(c, cookieName(c), token, {
    path: "/",
    httpOnly: true,
    secure: !isLocalDevelopment(c),
    sameSite: "Strict",
    maxAge: 43200,
  });
  return c.json({ user: await identity(c.env.DB, user) });
});
app.route("/api/tablet", tabletPublic);
app.route("/api", telegramPublic);
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, cookieName(c));
  if (!token)
    throw new HTTPException(401, {
      message: "Open this workspace from Telegram to sign in.",
    });
  const user = await c.env.DB.prepare(
    "SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1",
  )
    .bind(await sha256(token), seconds())
    .first<UserRow>();
  if (!user)
    throw new HTTPException(401, {
      message: "Your session has expired or your account is disabled.",
    });
  const launchData = c.req.header("X-Telegram-Init-Data");
  if (launchData || !isLocalDevelopment(c)) {
    if (!launchData || launchData.length > 12000)
      throw new HTTPException(401, {
        message: "Reopen this Mini App from your current Telegram account.",
      });
    const launch = await verifyTelegram(
      launchData,
      c.env.TELEGRAM_BOT_TOKEN,
      seconds(),
      43200,
    );
    if (launch.telegramId !== user.telegram_id)
      throw new HTTPException(401, {
        message:
          "Your Telegram account changed. Reopen the Mini App to sign in.",
      });
  }
  if (user.access === "employee") {
    const e = await c.env.DB.prepare(
      "SELECT activation_date,deactivation_date FROM employees WHERE user_id=?",
    )
      .bind(user.id)
      .first<{ activation_date: string; deactivation_date: string | null }>();
    if (
      !e ||
      e.activation_date > localDate() ||
      (e.deactivation_date !== null && e.deactivation_date <= localDate())
    )
      throw new HTTPException(403, {
        message: "Your employment is not currently active.",
      });
  }
  c.set("identity", await identity(c.env.DB, user));
  await next();
});
app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, cookieName(c))!;
  await c.env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash=?")
    .bind(await sha256(token))
    .run();
  deleteCookie(c, cookieName(c), {
    path: "/",
    secure: !isLocalDevelopment(c),
  });
  return c.json({ ok: true });
});
app.get("/api/me", async (c) => {
  const today = localDate();
  const employee = await c.env.DB.prepare(employeesQuery(true))
    .bind(today, today, c.get("identity").id)
    .first();
  return c.json({ user: c.get("identity"), employee, today, phase: 6 });
});
app.get("/api/catalog", async (c) => {
  const roles = (
    await c.env.DB.prepare("SELECT * FROM roles ORDER BY name").all()
  ).results;
  const levels = (
    await c.env.DB.prepare(
      `SELECT l.id,l.role_id,l.name,l.active,(SELECT hourly_rate FROM hourly_rate_history WHERE level_id=l.id AND effective_date<=? ORDER BY effective_date DESC LIMIT 1) AS hourly_rate FROM role_levels l ORDER BY l.name`,
    )
      .bind(localDate())
      .all()
  ).results;
  // No company wage disclosure to ordinary employees; their own current rate is in /me.
  return c.json({
    roles,
    levels: can(c.get("identity"), "salary.manage")
      ? levels
      : levels.map(({ hourly_rate, ...level }) => level),
  });
});
app.get("/api/employees", async (c) => {
  requirePermission(c, "employees.manage");
  const today = localDate();
  const rows = (
    await c.env.DB.prepare(employeesQuery()).bind(today, today).all()
  ).results;
  return c.json({
    employees: can(c.get("identity"), "salary.manage")
      ? rows
      : rows.map(({ hourly_rate, ...r }) => r),
  });
});
app.post("/api/employees", async (c) => {
  requirePermission(c, "employees.manage");
  const input = await body(c, employeeSchema);
  currentOrFuture(input.activationDate);
  await activeLevel(c.env.DB, input.levelId, input.activationDate);
  const userId = crypto.randomUUID(),
    id = crypto.randomUUID(),
    now = seconds();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO users(id,telegram_id,full_name,created_at,updated_at) VALUES(?,?,?,?,?)",
      ).bind(userId, input.telegramId, input.fullName, now, now),
      c.env.DB.prepare(
        "INSERT INTO employees(id,user_id,activation_date,created_at,updated_at) VALUES(?,?,?,?,?)",
      ).bind(id, userId, input.activationDate, now, now),
      c.env.DB.prepare(
        "INSERT INTO employee_role_history(id,employee_id,level_id,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        input.levelId,
        input.activationDate,
        c.get("identity").id,
        now,
      ),
      audit(c, "employee.create", id, null, input),
    ],
    { id, userId },
    201,
  );
});
app.patch("/api/employees/:id", async (c) => {
  requirePermission(c, "employees.manage");
  const input = await body(c, employeeUpdateSchema),
    id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT e.*,u.full_name,u.active,u.access FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=?",
  )
    .bind(id)
    .first<{
      user_id: string;
      access: string;
      activation_date: string;
      active: number;
    }>();
  if (!before) throw new HTTPException(404, { message: "Employee not found." });
  if (before.access !== "employee") superAdmin(c);
  // An unchanged status must not reset the end date or revoke sessions.
  if (input.active === !!before.active) delete input.active;
  if (
    input.fullName === undefined &&
    input.active === undefined &&
    input.levelId === undefined
  )
    throw new HTTPException(400, { message: "No changes supplied." });
  const updates: D1PreparedStatement[] = [];
  if (input.fullName !== undefined)
    updates.push(
      c.env.DB.prepare(
        "UPDATE users SET full_name=?,updated_at=? WHERE id=?",
      ).bind(input.fullName, seconds(), before.user_id),
    );
  if (input.active !== undefined) {
    if (before.user_id === c.get("identity").id)
      throw new HTTPException(400, {
        message: "You cannot disable your own account.",
      });
    if (!input.active && before.activation_date > localDate())
      throw new HTTPException(400, {
        message: "Future-dated employment cannot be ended before activation.",
      });
    updates.push(
      c.env.DB.prepare(
        "UPDATE users SET active=?,updated_at=? WHERE id=?",
      ).bind(input.active ? 1 : 0, seconds(), before.user_id),
      c.env.DB.prepare(
        "UPDATE employees SET deactivation_date=?,updated_at=? WHERE id=?",
      ).bind(input.active ? null : localDate(), seconds(), id),
      c.env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(
        before.user_id,
      ),
    );
  }
  if (input.levelId) {
    requirePermission(c, "salary.manage");
    const effective = input.effectiveDate ?? localDate();
    currentOrFuture(effective);
    if (effective < before.activation_date)
      throw new HTTPException(400, {
        message: "Assignment cannot precede employment.",
      });
    await activeLevel(c.env.DB, input.levelId, effective);
    updates.push(
      c.env.DB.prepare(
        "INSERT INTO employee_role_history(id,employee_id,level_id,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        input.levelId,
        effective,
        c.get("identity").id,
        seconds(),
      ),
    );
  }
  updates.push(audit(c, "employee.update", id, before, input, input.reason));
  return mutate(c, updates, { ok: true });
});
app.post("/api/employees/:id/telegram", async (c) => {
  superAdmin(c);
  const input = await body(c, linkSchema),
    id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT e.user_id,u.telegram_id FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=?",
  )
    .bind(id)
    .first<{ user_id: string; telegram_id: string }>();
  if (!before) throw new HTTPException(404, { message: "Employee not found." });
  if (before.user_id === c.get("identity").id)
    throw new HTTPException(400, {
      message: "Self relinking is not supported.",
    });
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "UPDATE users SET telegram_id=?,updated_at=? WHERE id=?",
      ).bind(input.telegramId, seconds(), before.user_id),
      c.env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(
        before.user_id,
      ),
      audit(c, "employee.telegram.change", id, before, input, input.reason),
    ],
    { ok: true },
  );
});
// Permanently removes a disabled employee who never accumulated work or pay history,
// such as a test account. Only setup rows are deleted; any attendance, request, review,
// payroll or audit row still referencing the person makes the foreign keys refuse it.
app.post("/api/employees/:id/delete", async (c) => {
  superAdmin(c);
  const input = await body(c, deleteEmployeeSchema),
    id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT e.id,e.user_id,u.full_name,u.telegram_id,u.access,u.active,e.activation_date,e.deactivation_date FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=?",
  )
    .bind(id)
    .first<{ user_id: string; full_name: string; access: string; active: number }>();
  if (!before) throw new HTTPException(404, { message: "Employee not found." });
  if (before.active || before.access !== "employee")
    throw new HTTPException(400, {
      message: "Disable the employee and remove any admin access before deleting.",
    });
  if (input.confirmName.trim() !== before.full_name)
    throw new HTTPException(400, {
      message: "Type the employee's full name exactly to confirm.",
    });
  const kept = new HTTPException(409, {
    message:
      "This employee has attendance, requests, reviews or payroll records, so they must stay for salary and audit history. Keep them disabled; disabled employees are hidden unless you choose to show them.",
  });
  if (
    await c.env.DB.prepare(
      "SELECT 1 FROM payroll_snapshots WHERE instr(payload_json,?)>0 LIMIT 1",
    )
      .bind(id)
      .first()
  )
    throw kept;
  const user = before.user_id;
  try {
    return await mutate(
      c,
      [
        ...[
          ["shift_overrides", "employee_id", id],
          ["weekly_schedules", "employee_id", id],
          ["scheduled_shifts", "employee_id", id],
          ["employee_role_history", "employee_id", id],
          ["notification_outbox", "user_id", user],
          ["telegram_chats", "user_id", user],
          ["auth_sessions", "user_id", user],
          ["idempotency_keys", "actor_id", user],
          ["admin_permissions", "user_id", user],
          ["employees", "id", id],
          ["users", "id", user],
        ].map(([table, column, value]) =>
          c.env.DB.prepare(`DELETE FROM ${table} WHERE ${column}=?`).bind(value),
        ),
        audit(c, "employee.delete", id, before, null, input.reason),
      ],
      { ok: true },
    );
  } catch (error) {
    if (String(error).includes("FOREIGN KEY constraint")) throw kept;
    throw error;
  }
});
app.get("/api/employees/:id/history", async (c) => {
  requirePermission(c, "salary.manage");
  const id = c.req.param("id");
  const assignments = (
    await c.env.DB.prepare(
      "SELECT h.*,l.name AS level_name,r.name AS role_name FROM employee_role_history h JOIN role_levels l ON l.id=h.level_id JOIN roles r ON r.id=l.role_id WHERE employee_id=? ORDER BY effective_date,id",
    )
      .bind(id)
      .all()
  ).results;
  const rates = (
    await c.env.DB.prepare(
      "SELECT h.* FROM hourly_rate_history h WHERE h.level_id IN (SELECT level_id FROM employee_role_history WHERE employee_id=?) ORDER BY effective_date,id",
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ assignments, rates });
});
app.post("/api/roles", async (c) => {
  requirePermission(c, "salary.manage");
  const input = await body(c, roleSchema),
    id = crypto.randomUUID();
  return mutate(
    c,
    [
      c.env.DB.prepare("INSERT INTO roles(id,name) VALUES(?,?)").bind(
        id,
        input.name,
      ),
      audit(c, "role.create", id, null, input),
    ],
    { id },
    201,
  );
});
app.post("/api/roles/:id/levels", async (c) => {
  requirePermission(c, "salary.manage");
  const input = await body(c, levelSchema),
    roleId = c.req.param("id"),
    id = crypto.randomUUID();
  currentOrFuture(input.effectiveDate);
  if (
    !(await c.env.DB.prepare("SELECT id FROM roles WHERE id=? AND active=1")
      .bind(roleId)
      .first())
  )
    throw new HTTPException(400, { message: "Choose an active role." });
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO role_levels(id,role_id,name) VALUES(?,?,?)",
      ).bind(id, roleId, input.name),
      c.env.DB.prepare(
        "INSERT INTO hourly_rate_history(id,level_id,hourly_rate,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        input.hourlyRate,
        input.effectiveDate,
        c.get("identity").id,
        seconds(),
      ),
      audit(c, "level.create", id, null, input),
    ],
    { id },
    201,
  );
});
app.post("/api/levels/:id/rates", async (c) => {
  requirePermission(c, "salary.manage");
  const input = await body(c, rateSchema),
    id = c.req.param("id");
  currentOrFuture(input.effectiveDate);
  if (
    !(await c.env.DB.prepare("SELECT id FROM role_levels WHERE id=?")
      .bind(id)
      .first())
  )
    throw new HTTPException(404, { message: "Level not found." });
  const previousRate = await c.env.DB.prepare(
    "SELECT hourly_rate,effective_date FROM hourly_rate_history WHERE level_id=? AND effective_date<=? ORDER BY effective_date DESC LIMIT 1",
  )
    .bind(id, input.effectiveDate)
    .first();
  return mutate(
    c,
    [
      c.env.DB.prepare(
        "INSERT INTO hourly_rate_history(id,level_id,hourly_rate,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        input.hourlyRate,
        input.effectiveDate,
        c.get("identity").id,
        seconds(),
      ),
      audit(c, "rate.create", id, previousRate, input, input.reason),
    ],
    { ok: true },
    201,
  );
});
for (const [path, table] of [
  ["roles", "roles"],
  ["levels", "role_levels"],
] as const) {
  app.patch(`/api/${path}/:id`, async (c) => {
    requirePermission(c, "salary.manage");
    const input = await body(c, catalogUpdateSchema),
      id = c.req.param("id");
    const before = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`)
      .bind(id)
      .first();
    if (!before) throw new HTTPException(404, { message: "Record not found." });
    const statements: D1PreparedStatement[] = [];
    if (input.name !== undefined)
      statements.push(
        c.env.DB.prepare(`UPDATE ${table} SET name=? WHERE id=?`).bind(
          input.name,
          id,
        ),
      );
    if (input.active !== undefined)
      statements.push(
        c.env.DB.prepare(`UPDATE ${table} SET active=? WHERE id=?`).bind(
          input.active ? 1 : 0,
          id,
        ),
      );
    return mutate(
      c,
      [
        ...statements,
        audit(c, `${path}.update`, id, before, input, input.reason),
      ],
      { ok: true },
    );
  });
}
app.get("/api/admin/users", async (c) => {
  superAdmin(c);
  const users = (
    await c.env.DB.prepare(
      "SELECT id,full_name,telegram_id,access,active FROM users ORDER BY full_name",
    ).all<UserRow>()
  ).results;
  return c.json({
    users: await Promise.all(
      users.map(async (u) => ({
        ...u,
        permissions: (await identity(c.env.DB, u)).permissions,
      })),
    ),
  });
});
app.post("/api/admin/users/:id/access", async (c) => {
  superAdmin(c);
  const input = await body(c, accessSchema),
    id = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(id)
    .first<UserRow>();
  if (!before) throw new HTTPException(404, { message: "User not found." });
  if (id === c.get("identity").id || before.access === "super_admin")
    throw new HTTPException(400, {
      message: "Super administrator access cannot be changed here.",
    });
  const previousAccess = await identity(c.env.DB, before);
  const statements = [
    c.env.DB.prepare("UPDATE users SET access=?,updated_at=? WHERE id=?").bind(
      input.access,
      seconds(),
      id,
    ),
    c.env.DB.prepare("DELETE FROM admin_permissions WHERE user_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(id),
    ...new Set(input.permissions),
  ].map((v) =>
    typeof v === "string"
      ? c.env.DB.prepare(
          "INSERT INTO admin_permissions(user_id,permission) VALUES(?,?)",
        ).bind(id, v)
      : v,
  );
  return mutate(
    c,
    [
      ...statements,
      audit(c, "admin.access.change", id, previousAccess, input, input.reason),
    ],
    { ok: true },
  );
});
app.get("/api/audit", async (c) => {
  requirePermission(c, "audit.view");
  return c.json({
    events: (
      await c.env.DB.prepare(
        "SELECT a.*,u.full_name AS actor_name,COALESCE((SELECT p.full_name FROM employees e JOIN users p ON p.id=e.user_id WHERE e.id=a.entity_id),(SELECT name FROM role_levels WHERE id=a.entity_id),(SELECT name FROM roles WHERE id=a.entity_id),(SELECT p.full_name FROM scheduled_shifts s JOIN employees e ON e.id=s.employee_id JOIN users p ON p.id=e.user_id WHERE s.id=a.entity_id),(SELECT p.full_name FROM employee_requests r JOIN employees e ON e.id=r.employee_id JOIN users p ON p.id=e.user_id WHERE r.id=a.entity_id)) AS entity_name FROM audit_logs a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id LIMIT 100",
      ).all()
    ).results,
  });
});
app.route("/api", attendanceRoutes);
app.route("/api", requestRoutes);
app.route("/api", disciplineRoutes);
app.route("/api", payrollRoutes);
app.route("/api", debtorsRoutes);
app.route("/api", notificationRoutes);
app.route("/api", rolePayRoutes);
app.all("/api/*", (c) => c.json({ error: "API route not found." }, 404));
app.all("*", async (c) => {
  // Old Telegram buttons still open the workers.dev host, where every save fails the
  // origin check. Send app pages to APP_ORIGIN; the URL fragment carrying Telegram's
  // launch data survives the redirect. Reception displays keep their host-bound pairing.
  const url = new URL(c.req.url),
    origin = new URL(c.env.APP_ORIGIN);
  if (
    !isLocalDevelopment(c) &&
    url.host !== origin.host &&
    !/^\/(reception|assets|brand)\//.test(url.pathname + "/") &&
    ["GET", "HEAD"].includes(c.req.method)
  )
    return c.redirect(origin.origin + url.pathname + url.search, 302);
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org",
  );
  if (!isLocalDevelopment(c))
    headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, headers });
});
app.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return c.json({ error: "Invalid query parameters." }, 400);
  console.error(
    "API failure",
    error instanceof Error ? error.name : "UnknownError",
  );
  return c.json(
    {
      error:
        "The service is temporarily unavailable. No success was confirmed; retry safely.",
    },
    503,
  );
});
export default Object.assign(app, {
  scheduled(
    _event: ScheduledController,
    env: AppEnv["Bindings"],
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(scheduledNotifications(env));
  },
});
