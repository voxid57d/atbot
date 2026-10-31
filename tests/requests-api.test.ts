import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import app from "../backend/index";
import type { Bindings } from "../backend/types";
import { localDate } from "../shared/domain";
import { dayStart } from "../shared/attendance";
import {
  deliverNotifications,
  notify,
  notifyAdminCheckIn,
  prepareReminders,
} from "../backend/notifications";
import { signedLogin, testBotToken } from "./helpers";
let mf: Miniflare,
  env: Bindings,
  root: string,
  employee: string,
  other: string,
  employeeId: string,
  otherId: string,
  userId: string;
const today = () => localDate(),
  tomorrow = () => localDate(Date.now() + 86400000),
  yesterday = () => localDate(Date.now() - 86400000);
function req(
  path: string,
  method = "GET",
  data?: unknown,
  cookie = root,
  key = crypto.randomUUID(),
) {
  return app.request(
    "http://127.0.0.1:8787/api" + path,
    {
      method,
      headers: {
        Origin: env.APP_ORIGIN,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    env,
  );
}
async function login(id: number) {
  const r = await req(
    "/auth/telegram",
    "POST",
    { initData: signedLogin(id) },
    "",
  );
  expect(r.status).toBe(200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function create(data: unknown, cookie = employee) {
  const r = await req("/requests", "POST", data, cookie);
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
const absence = (date = tomorrow()) => ({
  kind: "absence",
  date,
  category: "sick",
  reason: "A test explanation",
});
const correction = (extra = {}) => ({
  kind: "correction",
  date: yesterday(),
  type: "missing_check_in",
  sessionId: null,
  start: dayStart(yesterday()) + 8 * 3600,
  end: dayStart(yesterday()) + 10 * 3600,
  reason: "Forgot to scan the code",
  ...extra,
});
const decision = (id: string, approved = true, key = crypto.randomUUID()) =>
  req(
    `/requests/${id}/decision`,
    "POST",
    { approved, reason: "Reviewed the submitted evidence" },
    root,
    key,
  );
async function count(table: string) {
  return (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{
    n: number;
  }>())!.n;
}
async function baseSession(open = false) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO registered_tablets(id,name,credential_hash,credential_expires_at,created_by,created_at) VALUES('test-tablet','Test','fake-hash',?,?,?)",
  )
    .bind(
      Math.floor(Date.now() / 1000) + 1000,
      (await env.DB.prepare(
        "SELECT id FROM users WHERE access='super_admin'",
      ).first<{ id: string }>())!.id,
      Math.floor(Date.now() / 1000),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO attendance_sessions(id,employee_id,work_date,check_in,check_out,tablet_id,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      employeeId,
      yesterday(),
      dayStart(yesterday()) + 8 * 3600,
      open ? null : dayStart(yesterday()) + 10 * 3600,
      "test-tablet",
      Math.floor(Date.now() / 1000),
    )
    .run();
  return id;
}
beforeEach(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-06",
      d1Databases: ["DB"],
    }),
  );
  const db = await mf.getD1Database("DB"),
    dir = new URL("../database/migrations/", import.meta.url);
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  await db.batch(
    sql
      .replace(/--[^\r\n]*/g, "")
      .replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, (b) =>
        b.replaceAll(";", "__SQL_SEMI__"),
      )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s.replaceAll("__SQL_SEMI__", ";"))),
  );
  env = {
    DB: db as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("test") } as unknown as Fetcher,
    APP_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:5173",
    TELEGRAM_BOT_TOKEN: testBotToken,
    BOOTSTRAP_TELEGRAM_ID: "100001",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    NOTIFICATIONS_ENABLED: "false",
  };
  root = await login(100001);
  const level = (await (
    await req("/roles/office-manager/levels", "POST", {
      name: "Test level",
      hourlyRate: 12000,
      effectiveDate: today(),
    })
  ).json()) as { id: string };
  for (const id of [200001, 200002]) {
    const r = await req("/employees", "POST", {
      fullName: `Employee ${id}`,
      telegramId: String(id),
      levelId: level.id,
      activationDate: today(),
    });
    expect(r.status).toBe(201);
    const data = (await r.json()) as { id: string; userId: string };
    if (id === 200001) {
      employeeId = data.id;
      userId = data.userId;
    } else otherId = data.id;
  }
  // Historical fixtures use yesterday's employment and rate, without changing production.
  await db.batch([
    db.prepare("UPDATE employees SET activation_date=?").bind(yesterday()),
    db
      .prepare("UPDATE employee_role_history SET effective_date=?")
      .bind(yesterday()),
    db
      .prepare("UPDATE hourly_rate_history SET effective_date=?")
      .bind(yesterday()),
  ]);
  employee = await login(200001);
  other = await login(200002);
});
afterEach(async () => {
  await mf?.dispose();
  vi.restoreAllMocks();
});
describe("Phase 3 requests on isolated D1", () => {
  it("adds audited approved manual attendance without scans, deduplicates and recalculates employee pay", async () => {
    await env.DB.prepare("INSERT INTO weekly_schedules(id,employee_id,weekday,start_minute,end_minute,effective_date,active,created_by,created_at) VALUES('manual-weekly',?,?,480,720,?,1,?,1)").bind(employeeId,new Date(yesterday()+"T00:00:00Z").getUTCDay(),yesterday(),userId).run();
    const input = {
      employeeId,
      date: yesterday(),
      start: dayStart(yesterday()) + 8 * 3600,
      end: dayStart(yesterday()) + 10 * 3600 + 13 * 60,
      reason: "",
    };
    expect(
      (await req("/attendance/manual", "POST", input, employee)).status,
    ).toBe(403);
    const adminId = (await env.DB.prepare(
      "SELECT user_id FROM employees WHERE id=?",
    )
      .bind(otherId)
      .first<{ user_id: string }>())!.user_id;
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=?")
      .bind(adminId)
      .run();
    await env.DB.prepare(
      "INSERT INTO admin_permissions(user_id,permission) VALUES(?,'attendance.manage')",
    )
      .bind(adminId)
      .run();
    const key = crypto.randomUUID(),
      response = await req("/attendance/manual", "POST", input, other, key);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      (await req("/attendance/manual", "POST", input, other, key)).status,
    ).toBe(201);
    const id = ((await response.json()) as any).id;
    const row = await env.DB.prepare(
      "SELECT a.*,r.status,r.decided_by FROM manual_attendance a JOIN employee_requests r ON r.id=a.id WHERE a.id=?",
    )
      .bind(id)
      .first<any>();
    expect(row.check_in).toBe(input.start);
    expect(row.check_out).toBe(input.end);
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(adminId);
    expect(await count("manual_attendance")).toBe(1);
    expect(await count("attendance_sessions")).toBe(0);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='attendance.manual.add'",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
    expect((await req("/attendance/manual", "POST", input, other)).status).toBe(
      409,
    );
    expect(await count("manual_attendance")).toBe(1);
    const mine = await req(
      "/attendance/mine?periodDate=" + yesterday(),
      "GET",
      undefined,
      employee,
    );
    const day = ((await mine.json()) as any).days.find(
      (d: any) => d.date === yesterday(),
    );
    expect(day.actualSeconds).toBe(2 * 3600 + 13 * 60);
    expect(day.estimatedGross).toBe(24000);
    expect(day.paidSeconds).toBe(7200);
  });
  it("rejects invalid manual times, employment dates, overlap, pending corrections and locked months atomically", async () => {
    const base = {
      employeeId,
      date: yesterday(),
      start: dayStart(yesterday()) + 8 * 3600,
      end: dayStart(yesterday()) + 10 * 3600,
      reason: "",
    };
    expect(
      (await req("/attendance/manual", "POST", { ...base, end: base.start }))
        .status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/manual", "POST", {
          ...base,
          start: dayStart(yesterday()),
          end: dayStart(yesterday()) + 19 * 3600,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/manual", "POST", {
          ...base,
          end: dayStart(today()) + 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/manual", "POST", {
          ...base,
          date: tomorrow(),
          start: dayStart(tomorrow()) + 8 * 3600,
          end: dayStart(tomorrow()) + 10 * 3600,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/manual", "POST", {
          ...base,
          employeeId: "missing",
        })
      ).status,
    ).toBe(404);
    await env.DB.prepare("UPDATE employees SET activation_date=? WHERE id=?")
      .bind(today(), employeeId)
      .run();
    expect((await req("/attendance/manual", "POST", base)).status).toBe(400);
    await env.DB.prepare("UPDATE employees SET activation_date=? WHERE id=?")
      .bind(yesterday(), employeeId)
      .run();
    await baseSession();
    expect((await req("/attendance/manual", "POST", base)).status).toBe(409);
    expect(await count("manual_attendance")).toBe(0);
    expect(await count("employee_requests")).toBe(0);
    const pending = await create(correction());
    expect((await req("/attendance/manual", "POST", base)).status).toBe(409);
    expect((await decision(pending, false)).status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) SELECT 'local-manual-lock',?, ?,id,unixepoch() FROM users WHERE access='super_admin'",
    )
      .bind(yesterday(), yesterday())
      .run();
    expect(
      (
        await req("/attendance/manual", "POST", {
          ...base,
          start: dayStart(yesterday()) + 18 * 3600,
          end: dayStart(yesterday()) + 19 * 3600,
        })
      ).status,
    ).toBe(409);
    expect(await count("manual_attendance")).toBe(0);
  });
  it("sends a bulk message once per selected user and rejects unavailable selections without partial queueing", async () => {
    const rootId = (await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) SELECT id,telegram_id,1,unixepoch() FROM users WHERE id IN (?,?)",
    )
      .bind(rootId, userId)
      .run();
    const key = crypto.randomUUID(),
      input = {
        userIds: [rootId, userId, userId],
        message: "One announcement for everyone.",
      };
    const first = await req(
      "/notifications/messages",
      "POST",
      input,
      root,
      key,
    );
    expect(first.status, await first.clone().text()).toBe(201);
    expect(((await first.json()) as any).recipientCount).toBe(2);
    expect(
      (await req("/notifications/messages", "POST", input, root, key)).status,
    ).toBe(201);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) AS n FROM notification_outbox WHERE notification_kind='admin_message'",
      ).first<{ n: number }>())!.n,
    ).toBe(2);
    const unavailable = (await env.DB.prepare(
      "SELECT user_id FROM employees WHERE id=?",
    )
      .bind(otherId)
      .first<{ user_id: string }>())!.user_id;
    expect(
      (
        await req("/notifications/messages", "POST", {
          ...input,
          userIds: [userId, unavailable],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req("/notifications/messages", "POST", {
          ...input,
          userIds: [userId, "missing"],
        })
      ).status,
    ).toBe(404);
    expect(
      (await req("/notifications/messages", "POST", { ...input, userIds: [] }))
        .status,
    ).toBe(400);
    expect(
      (await req("/notifications/messages", "POST", input, employee)).status,
    ).toBe(403);
    const history = (await (
      await req("/notifications/messages")
    ).json()) as any;
    expect(history.messages).toHaveLength(2);
    expect(new Set(history.messages.map((m: any) => m.text)).size).toBe(1);
    env.NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await deliverNotifications(env, send);
    await deliverNotifications(env, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      send.mock.calls
        .map((call) => JSON.parse(call[1]!.body as string).chat_id)
        .sort(),
    ).toEqual(["100001", "200001"]);
  });
  it("lets admins message one user, preserves plain text, deduplicates and shows their own history", async () => {
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) VALUES(?,'200001',1,?)",
    )
      .bind(userId, Math.floor(Date.now() / 1000))
      .run();
    const adminId = (await env.DB.prepare(
      "SELECT user_id FROM employees WHERE id=?",
    )
      .bind(otherId)
      .first<{ user_id: string }>())!.user_id;
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=?")
      .bind(adminId)
      .run();
    const key = crypto.randomUUID(),
      input = { userId, message: "Hello <team>!\nThank you for today." };
    const response = await req(
      "/notifications/messages",
      "POST",
      input,
      other,
      key,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      (await req("/notifications/messages", "POST", input, other, key)).status,
    ).toBe(201);
    const id = ((await response.json()) as { id: string }).id;
    const listed = await req(
      "/notifications/messages/users",
      "GET",
      undefined,
      other,
    );
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as any).users.find((u: any) => u.id === userId)
        .ready,
    ).toBe(1);
    expect(
      (await req("/notifications/messages", "GET", undefined, employee)).status,
    ).toBe(403);
    expect(
      (await req("/notifications/messages/users", "GET", undefined, employee))
        .status,
    ).toBe(403);
    expect(
      (await req("/notifications/messages", "POST", input, employee)).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/notifications/messages",
          "POST",
          { ...input, message: "  " },
          other,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/notifications/messages",
          "POST",
          { ...input, message: "x".repeat(3001) },
          other,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/notifications/messages",
          "POST",
          { ...input, userId: "missing" },
          other,
        )
      ).status,
    ).toBe(404);
    const history = (await (
      await req("/notifications/messages", "GET", undefined, other)
    ).json()) as any;
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].id).toBe(id);
    expect(
      ((await (await req("/notifications/messages")).json()) as any).messages,
    ).toHaveLength(0);
    env.NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await deliverNotifications(env, send);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][1]!.body as string);
    expect(payload.chat_id).toBe("200001");
    expect(payload.text).toContain(input.message);
    expect(payload.text).toContain("Employee 200002");
    expect(payload.parse_mode).toBeUndefined();
    expect(
      (
        (await (
          await req("/notifications/messages", "GET", undefined, other)
        ).json()) as any
      ).messages[0].status,
    ).toBe("sent");
  });
  it("rejects bot-unavailable users and suppresses messages after Telegram relinking or sender demotion", async () => {
    const input = { userId, message: "Local test" };
    expect((await req("/notifications/messages", "POST", input)).status).toBe(
      409,
    );
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) VALUES(?,'200001',1,?)",
    )
      .bind(userId, Math.floor(Date.now() / 1000))
      .run();
    expect((await req("/notifications/messages", "POST", input)).status).toBe(
      201,
    );
    await env.DB.prepare("UPDATE users SET telegram_id='299999' WHERE id=?")
      .bind(userId)
      .run();
    await env.DB.prepare(
      "UPDATE telegram_chats SET chat_id='299999' WHERE user_id=?",
    )
      .bind(userId)
      .run();
    env.NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    const sender = (await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>())!;
    await env.DB.prepare("UPDATE users SET telegram_id='200001' WHERE id=?")
      .bind(userId)
      .run();
    await env.DB.prepare(
      "UPDATE telegram_chats SET chat_id='200001' WHERE user_id=?",
    )
      .bind(userId)
      .run();
    await env.DB.prepare("UPDATE users SET access='employee' WHERE id=?")
      .bind(sender.id)
      .run();
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("queues admin check-in details atomically, deduplicates retries and delivers only once", async () => {
    const rootUser = await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) VALUES(?,'100001',1,?)",
    )
      .bind(rootUser!.id, Math.floor(Date.now() / 1000))
      .run();
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=?")
      .bind(
        (await env.DB.prepare("SELECT user_id FROM employees WHERE id=?")
          .bind(otherId)
          .first<{ user_id: string }>())!.user_id,
      )
      .run();
    const code = "b".repeat(64);
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) SELECT user_id,'200002',1,unixepoch() FROM employees WHERE id=?",
    )
      .bind(otherId)
      .run();
    expect(
      (
        await req("/tablets", "POST", {
          name: "Local alert test",
          pairingCode: code,
        })
      ).status,
    ).toBe(201);
    const paired = await req("/tablet/pair", "POST", { code }, "");
    const cookie = paired.headers.get("set-cookie")!.split(";")[0];
    const token = (
      (await (await req("/tablet/qr", "GET", undefined, cookie)).json()) as {
        token: string;
      }
    ).token;
    const key = crypto.randomUUID();
    expect(
      (await req("/attendance/check-in", "POST", { qr: token }, employee, key))
        .status,
    ).toBe(201);
    expect(
      (await req("/attendance/check-in", "POST", { qr: token }, employee, key))
        .status,
    ).toBe(201);
    expect(
      (await req("/attendance/check-in", "POST", { qr: token }, employee))
        .status,
    ).toBe(409);
    const rows = (
      await env.DB.prepare(
        "SELECT user_id,text FROM notification_outbox WHERE notification_kind='admin_check_in'",
      ).all<{ user_id: string; text: string }>()
    ).results;
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.user_id === rootUser!.id)).toBe(true);
    expect(rows[0].text).toContain("Employee 200001");
    expect(rows[0].text).toContain(today());
    expect(rows[0].text).toContain("(Tashkent)");
    expect(rows[0].text).toContain("No assigned shift");
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    env.NOTIFICATIONS_ENABLED = "true";
    await deliverNotifications(env, send as typeof fetch);
    await deliverNotifications(env, send as typeof fetch);
    expect(send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(send.mock.calls[0][1]!.body as string);
    expect(["100001", "200002"]).toContain(payload.chat_id);
    expect(payload.text).toBe(rows[0].text);
    const checkoutKey = crypto.randomUUID();
    expect(
      (
        await req(
          "/attendance/check-out",
          "POST",
          { qr: token },
          employee,
          checkoutKey,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          "/attendance/check-out",
          "POST",
          { qr: token },
          employee,
          checkoutKey,
        )
      ).status,
    ).toBe(200);
    const outs = (
      await env.DB.prepare(
        "SELECT text FROM notification_outbox WHERE event_key LIKE 'admin-check-out:%'",
      ).all<{ text: string }>()
    ).results;
    expect(outs).toHaveLength(2);
    expect(outs[0].text).toContain("Employee 200001");
    expect(outs[0].text).toContain("This visit:");
    await deliverNotifications(env, send as typeof fetch);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it("never delivers admin check-ins after removal of admin access or notification opt-out", async () => {
    const rootUser = await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO telegram_chats(user_id,chat_id,enabled,updated_at) VALUES(?,'100001',1,?)",
    )
      .bind(rootUser!.id, Math.floor(Date.now() / 1000))
      .run();
    await notifyAdminCheckIn(
      env.DB,
      "local-role-guard",
      "Local check-in",
    ).run();
    await env.DB.prepare(
      "INSERT INTO admin_permissions(user_id,permission) VALUES(?,'attendance.manage')",
    )
      .bind(rootUser!.id)
      .run();
    await env.DB.prepare("UPDATE users SET access='employee' WHERE id=?")
      .bind(rootUser!.id)
      .run();
    env.NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    await env.DB.prepare("UPDATE users SET access='super_admin' WHERE id=?")
      .bind(rootUser!.id)
      .run();
    await env.DB.prepare("UPDATE telegram_chats SET enabled=0 WHERE user_id=?")
      .bind(rootUser!.id)
      .run();
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("lets an administrator correct a next-day checkout, preserves the original and deduplicates saving", async () => {
    const sid = await baseSession(true),
      originalOut = dayStart(today()) + 11 * 3600;
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_out=? WHERE id=?",
    )
      .bind(originalOut, sid)
      .run();
    const input = {
      checkout: dayStart(yesterday()) + 17 * 3600,
      expectedCheckIn: dayStart(yesterday()) + 8 * 3600,
      expectedCheckout: originalOut,
      reason: "",
    };
    expect(
      (
        await req(
          `/attendance/${sid}/correct-checkout`,
          "POST",
          input,
          employee,
        )
      ).status,
    ).toBe(403);
    const key = crypto.randomUUID();
    expect(
      (
        await req(
          `/attendance/${sid}/correct-checkout`,
          "POST",
          input,
          root,
          key,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await req(
          `/attendance/${sid}/correct-checkout`,
          "POST",
          input,
          root,
          key,
        )
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT check_out,checkout_source FROM attendance_sessions WHERE id=?",
      )
        .bind(sid)
        .first(),
    ).toMatchObject({ check_out: input.checkout, checkout_source: "admin" });
    const original = (await env.DB.prepare(
      "SELECT original_json FROM attendance_originals WHERE session_id=?",
    )
      .bind(sid)
      .first<{ original_json: string }>())!;
    expect(JSON.parse(original.original_json).check_out).toBe(originalOut);
    expect(await count("employee_requests")).toBe(1);
    expect(
      (await req(`/attendance/${sid}/correct-checkout`, "POST", input)).status,
    ).toBe(409);
  });
  it("rejects wrong-day, overlapping and locked corrections without partial records", async () => {
    const sid = await baseSession(false),
      start = dayStart(yesterday()) + 8 * 3600,
      out = dayStart(yesterday()) + 10 * 3600;
    const input = {
      checkout: dayStart(yesterday()) + 11 * 3600,
      expectedCheckIn: start,
      expectedCheckout: out,
    };
    expect(
      (
        await req(`/attendance/${sid}/correct-checkout`, "POST", {
          ...input,
          checkout: dayStart(today()) + 1,
        })
      ).status,
    ).toBe(400);
    const other = await baseSession(false);
    expect(
      (await req(`/attendance/${sid}/correct-checkout`, "POST", input)).status,
    ).toBe(409);
    expect(await count("employee_requests")).toBe(0);
    expect(await count("attendance_originals")).toBe(0);
    await env.DB.prepare("DELETE FROM attendance_sessions WHERE id=?")
      .bind(other)
      .run();
    const actor = (await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES('correction-lock',?,?,?,?)",
    )
      .bind(yesterday(), yesterday(), actor, Math.floor(Date.now() / 1000))
      .run();
    expect(
      (await req(`/attendance/${sid}/correct-checkout`, "POST", input)).status,
    ).toBe(409);
    expect(await count("employee_requests")).toBe(0);
  });
  it("delivers a due shift reminder once through the guarded outbox", async () => {
    const s = await messageShift(),
      time = s.start - 1800;
    await prepareReminders(env, time);
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue(time * 1000);
    const send = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true })),
    );
    await Promise.all([
      deliverNotifications(env, send),
      deliverNotifications(env, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string).text).toContain(
      "Your shift starts at 10:00",
    );
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.status,
    ).toBe("sent");
  });
  it("cancels queued encouragement when the employee opts out", async () => {
    const s = await messageShift();
    await openMessageSession(s);
    const time = s.start + Math.floor((8 * 3600) / 3);
    await prepareReminders(env, time);
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: true, encouragement: false },
      employee,
    );
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue(time * 1000);
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.status,
    ).toBe("failed");
  });
  async function messageShift() {
    const d = tomorrow(),
      start = dayStart(d) + 10 * 3600,
      id = crypto.randomUUID();
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: true, encouragement: true },
      employee,
    );
    await env.DB.prepare(
      "INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,overtime_approved,created_at) VALUES(?,?,?,?,?,'extra','scheduled',1,?)",
    )
      .bind(
        id,
        employeeId,
        d,
        start,
        start + 8 * 3600,
        Math.floor(Date.now() / 1000),
      )
      .run();
    return { id, d, start };
  }
  async function openMessageSession(s: {
    id: string;
    d: string;
    start: number;
  }) {
    const rootId = (await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO registered_tablets(id,name,credential_hash,created_by,created_at) VALUES('message-tablet','Local test','fake-message',?,?)",
    )
      .bind(rootId, Math.floor(Date.now() / 1000))
      .run();
    await env.DB.prepare(
      "INSERT INTO attendance_sessions(id,employee_id,shift_id,work_date,check_in,tablet_id,created_at) VALUES('message-session',?,?,?,?, 'message-tablet',?)",
    )
      .bind(employeeId, s.id, s.d, s.start, s.start)
      .run();
  }
  it("queues the new start reminder once and suppresses delivery after cancellation", async () => {
    const s = await messageShift(),
      time = s.start - 1800;
    await prepareReminders(env, time);
    await prepareReminders(env, time + 60);
    const queued = (
      await env.DB.prepare("SELECT * FROM notification_outbox WHERE shift_id=?")
        .bind(s.id)
        .all()
    ).results;
    expect(queued).toHaveLength(1);
    expect(queued[0].text).toContain("10:00");
    await env.DB.prepare(
      "UPDATE scheduled_shifts SET status='cancelled' WHERE id=?",
    )
      .bind(s.id)
      .run();
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue((time + 60) * 1000);
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await env.DB.prepare(
          "SELECT error_code FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.error_code,
    ).toBe("stale_shift");
  });
  it("sends two encouragements and an end reminder only with an open attendance session", async () => {
    const s = await messageShift();
    await prepareReminders(env, s.start + Math.floor((8 * 3600) / 3));
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.n,
    ).toBe(0);
    await openMessageSession(s);
    await prepareReminders(env, s.start + Math.floor((8 * 3600) / 3));
    await prepareReminders(env, s.start + Math.floor((16 * 3600) / 3));
    await prepareReminders(env, s.start + 8 * 3600 - 600);
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.n,
    ).toBe(3);
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_out=? WHERE id='message-session'",
    )
      .bind(s.start + 8 * 3600 - 500)
      .run();
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue((s.start + 8 * 3600 - 500) * 1000);
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
  });
  it("rechecks an approved absence before queued delivery and sends a warm sick-leave decision", async () => {
    const s = await messageShift();
    await prepareReminders(env, s.start - 1800);
    const id = await create(absence(s.d));
    expect((await decision(id)).status).toBe(200);
    const text = (
      await env.DB.prepare(
        "SELECT text FROM notification_outbox WHERE event_key=?",
      )
        .bind(`decision:${id}`)
        .first()
    )?.text;
    expect(text).toContain("Rest up and feel better soon");
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue((s.start - 1700) * 1000);
    await deliverNotifications(env, send);
    expect(
      send.mock.calls.every(
        (call) =>
          !JSON.parse(
            (call as unknown as [string, RequestInit])[1].body as string,
          ).text.includes("Your shift starts"),
      ),
    ).toBe(true);
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM notification_outbox WHERE shift_id=?",
        )
          .bind(s.id)
          .first()
      )?.status,
    ).toBe("failed");
  });
  it("preserves an encouragement opt-out when an older client updates reminder preferences", async () => {
    expect(
      (
        await req(
          "/notifications/preferences",
          "POST",
          { enabled: true, reminders: true, encouragement: false },
          employee,
        )
      ).status,
    ).toBe(200);
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: false },
      employee,
    );
    expect(
      (await (
        await req("/notifications/preferences", "GET", undefined, employee)
      ).json()) as any,
    ).toMatchObject({ encouragement: 0, reminders: 0 });
  });
  it("allows an absence and its decision without a reason, retaining decision identity", async () => {
    const creation = await req(
      "/requests",
      "POST",
      { ...absence(), reason: "" },
      employee,
    );
    expect(creation.status, await creation.clone().text()).toBe(201);
    const { id } = (await creation.json()) as { id: string };
    const response = await req(`/requests/${id}/decision`, "POST", {
      approved: true,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await env.DB.prepare(
      "SELECT * FROM employee_requests WHERE id=?",
    )
      .bind(id)
      .first<any>();
    expect(row.reason).toBe("");
    expect(row.decision_reason).toBeNull();
    expect(row.decided_by).toBeTruthy();
    expect(row.decided_at).toBeGreaterThan(0);
    expect(await count("audit_logs")).toBeGreaterThan(0);
  });
  it("keeps today's attendance and schedule visible when browsing another period", async () => {
    const id = await baseSession();
    await env.DB.prepare(
      "UPDATE attendance_sessions SET work_date=?,check_in=check_in+86400,check_out=check_out+86400 WHERE id=?",
    )
      .bind(today(), id)
      .run();
    await req("/schedules/weekly", "POST", {
      employeeId,
      weekday: new Date(tomorrow() + "T00:00:00Z").getUTCDay(),
      startMinute: 480,
      endMinute: 720,
      effectiveDate: tomorrow(),
      reason: "Upcoming work schedule",
    });
    const past = localDate(Date.now() - 40 * 86400000);
    const data = (await (
      await req(
        `/attendance/mine?periodDate=${past}`,
        "GET",
        undefined,
        employee,
      )
    ).json()) as {
      todayAttendance: { actualSeconds: number };
      upcoming: unknown[];
      summary: { actualSeconds: number };
    };
    expect(data.todayAttendance.actualSeconds).toBe(7200);
    expect(data.summary.actualSeconds).toBe(0);
    expect(data.upcoming.length).toBeGreaterThan(0);
  });
  it("does not deliver queued messages to a relinked Telegram account or demoted administrator", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: false },
      employee,
    );
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: false },
      root,
    );
    await env.DB.batch([
      notify(env.DB, "private-event", "Test message", employeeId),
      notify(env.DB, "admin-event", "Test admin message", undefined, true),
    ]);
    await env.DB.prepare("UPDATE users SET telegram_id=? WHERE id=?")
      .bind("200003", userId)
      .run();
    await env.DB.prepare(
      "UPDATE users SET access='employee' WHERE access='super_admin'",
    ).run();
    const send = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await deliverNotifications(env, send as typeof fetch);
    expect(send).not.toHaveBeenCalled();
  });
  it("cannot re-enable notifications by replaying an older webhook after stop", async () => {
    const webhook = (update_id: number, text: string) =>
      app.request(
        "http://127.0.0.1:8787/api/telegram/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET!,
          },
          body: JSON.stringify({
            update_id,
            message: {
              chat: { id: 200001, type: "private" },
              from: { id: 200001 },
              text,
            },
          }),
        },
        env,
      );
    expect((await webhook(1, "/start")).status).toBe(200);
    expect((await webhook(2, "/stop")).status).toBe(200);
    expect((await webhook(1, "/start")).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT enabled,last_update_id FROM telegram_chats",
      ).first(),
    ).toMatchObject({ enabled: 0, last_update_id: 2 });
    expect(await count("notification_outbox")).toBe(2);
  });
  it("isolates records and denies employee review and policy changes", async () => {
    await create(absence());
    const mine = (await (
      await req("/requests/mine", "GET", undefined, other)
    ).json()) as { requests: unknown[] };
    expect(mine.requests).toHaveLength(0);
    expect(
      (await req("/requests/review", "GET", undefined, employee)).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/requests/categories/sick",
          "POST",
          { paid: true, reason: "Unauthorized attempt" },
          employee,
        )
      ).status,
    ).toBe(403);
  });
  it("deduplicates concurrent submissions, approval and notification events", async () => {
    const key = crypto.randomUUID(),
      input = absence();
    const a = await Promise.all([
      req("/requests", "POST", input, employee, key),
      req("/requests", "POST", input, employee, key),
    ]);
    expect(a.map((r) => r.status)).toEqual([201, 201]);
    expect(await count("employee_requests")).toBe(1);
    const id = ((await a[0].json()) as { id: string }).id;
    const decisions = await Promise.all([decision(id), decision(id)]);
    expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("notification_outbox")).toBe(3);
    expect((await req("/requests", "POST", input, employee)).status).toBe(409);
  });
  it("allows a fresh absence after rejection and snapshots paid policies", async () => {
    const id = await create(absence());
    expect((await decision(id, false)).status).toBe(200);
    expect(
      (
        await req("/requests/categories/sick", "POST", {
          paid: true,
          reason: "Explicit paid leave policy",
        })
      ).status,
    ).toBe(200);
    const second = await create(absence());
    expect((await decision(second)).status).toBe(200);
    expect(
      (await env.DB.prepare("SELECT paid FROM employee_requests WHERE id=?")
        .bind(second)
        .first<{ paid: number }>())!.paid,
    ).toBe(1);
    await req("/requests/categories/sick", "POST", {
      paid: false,
      reason: "Future policy is unpaid",
    });
    expect(
      (await env.DB.prepare("SELECT paid FROM employee_requests WHERE id=?")
        .bind(second)
        .first<{ paid: number }>())!.paid,
    ).toBe(1);
    expect(await count("attendance_sessions")).toBe(0);
  });
  it("audits late absence and distinguishes approved absence on live attendance", async () => {
    const id = await create(absence(yesterday()));
    expect((await decision(id)).status).toBe(200);
    const live = (await (
      await req(`/attendance/live?date=${yesterday()}`)
    ).json()) as {
      employees: { id: string; status: string; actualSeconds: number }[];
    };
    expect(live.employees.find((e) => e.id === employeeId)).toMatchObject({
      status: "Approved absence",
      actualSeconds: 0,
    });
    const audit = await env.DB.prepare(
      "SELECT after_json FROM audit_logs WHERE action='request.absence.create'",
    ).first<{ after_json: string }>();
    expect(JSON.parse(audit!.after_json).lateSubmitted).toBe(true);
  });
  it("approves missing attendance, recalculates earnings and protects the schedule", async () => {
    await env.DB.prepare(
      "INSERT INTO weekly_schedules(id,employee_id,weekday,start_minute,end_minute,effective_date,active,created_by,created_at) VALUES('weekly',?,?,480,720,?,1,?,1)",
    )
      .bind(
        employeeId,
        new Date(yesterday() + "T00:00:00Z").getUTCDay(),
        yesterday(),
        userId,
      )
      .run();
    const id = await create(correction());
    expect((await decision(id)).status).toBe(200);
    const mine = (await (
      await req(
        `/attendance/mine?periodDate=${yesterday()}`,
        "GET",
        undefined,
        employee,
      )
    ).json()) as {
      days: { date: string; estimatedGross: number; regularSeconds: number }[];
    };
    expect(mine.days.find((d) => d.date === yesterday())).toMatchObject({
      estimatedGross: 24000,
      regularSeconds: 7200,
    });
    expect(
      (
        await req("/schedules/weekly", "POST", {
          employeeId,
          weekday: 1,
          startMinute: 0,
          endMinute: 60,
          effectiveDate: today(),
          active: true,
          reason: "Future change allowed",
        })
      ).status,
    ).toBe(201);
    await expect(
      env.DB.prepare(
        "INSERT INTO shift_overrides(id,employee_id,work_date,cancelled,reason,created_by,created_at) VALUES('bad',?,?,1,'Bad historical change',?,1)",
      )
        .bind(employeeId, yesterday(), userId)
        .run(),
    ).rejects.toThrow("ATBOT_CONFLICT");
  });
  it("preserves original timestamps and closes a forgotten session", async () => {
    const sessionId = await baseSession(true),
      id = await create(correction({ sessionId, type: "missing_check_out" }));
    expect((await decision(id)).status).toBe(200);
    expect(await count("attendance_closures")).toBe(1);
    const original = await env.DB.prepare(
      "SELECT original_json FROM attendance_originals WHERE session_id=?",
    )
      .bind(sessionId)
      .first<{ original_json: string }>();
    expect(JSON.parse(original!.original_json).check_out).toBeNull();
    const history = (await (
      await req(
        `/attendance/history?from=${yesterday()}&to=${yesterday()}`,
        "GET",
        undefined,
        employee,
      )
    ).json()) as { originals: unknown[] };
    expect(history.originals).toHaveLength(1);
  });
  it("rejects stale corrections after checkout without changing originals", async () => {
    const sessionId = await baseSession(true),
      id = await create(correction({ sessionId, type: "missing_check_out" }));
    const code = "d".repeat(64);
    await req("/tablets", "POST", {
      name: "Local checkout fixture",
      pairingCode: code,
    });
    const paired = await req("/tablet/pair", "POST", { code }, "");
    expect(paired.status).toBe(200);
    const cookie = paired.headers.get("set-cookie")!.split(";")[0];
    const token = (
      (await (await req("/tablet/qr", "GET", undefined, cookie)).json()) as {
        token: string;
      }
    ).token;
    expect(
      (await req("/attendance/check-out", "POST", { qr: token }, employee))
        .status,
    ).toBe(200);
    expect((await decision(id)).status).toBe(409);
    expect(await count("attendance_originals")).toBe(0);
  });
  it("rejects overlapping corrections, foreign sessions and future timestamps", async () => {
    const sessionId = await baseSession(),
      id = await create(correction());
    expect((await decision(id)).status).toBe(409);
    expect(
      (await req("/requests", "POST", correction({ sessionId }), other)).status,
    ).toBe(404);
    expect(
      (
        await req(
          "/requests",
          "POST",
          correction({
            date: tomorrow(),
            start: dayStart(tomorrow()) + 3600,
            end: dayStart(tomorrow()) + 7200,
          }),
          employee,
        )
      ).status,
    ).toBe(400);
  });
  it("blocks decisions once payroll is locked and leaves the request pending", async () => {
    const id = await create(correction());
    const admin = (await env.DB.prepare(
      "SELECT id FROM users WHERE access='super_admin'",
    ).first<{ id: string }>())!.id;
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES(?,?,?,?,1)",
    )
      .bind("lock", yesterday(), today(), admin)
      .run();
    expect((await decision(id)).status).toBe(409);
    expect(await count("manual_attendance")).toBe(0);
    expect(
      (await env.DB.prepare("SELECT status FROM employee_requests WHERE id=?")
        .bind(id)
        .first<{ status: string }>())!.status,
    ).toBe("pending");
  });
  it("records overtime approval but never invents worked time", async () => {
    const id = await create({
      kind: "overtime",
      date: yesterday(),
      start: dayStart(yesterday()) + 17 * 3600,
      end: dayStart(yesterday()) + 18 * 3600,
      reason: "Additional work requested",
    });
    expect((await decision(id)).status).toBe(200);
    expect(await count("overtime_approvals")).toBe(1);
    expect(await count("attendance_sessions")).toBe(0);
  });
  it("creates coverage only after acceptance and keeps original absence separate", async () => {
    const absenceId = await create(absence());
    await decision(absenceId);
    const r = await req("/coverage", "POST", {
      absenceId,
      employeeId: otherId,
      start: dayStart(tomorrow()) + 16 * 3600,
      end: dayStart(tomorrow()) + 17 * 3600,
      requiresAcceptance: true,
      overtimeApproved: true,
      reason: "Replacement shift needed",
    });
    expect(r.status).toBe(201);
    const id = ((await r.json()) as { id: string }).id;
    expect(await count("scheduled_shifts")).toBe(0);
    expect(
      (
        await req(
          `/coverage/${id}/decision`,
          "POST",
          { accepted: true, reason: "I can cover the shift" },
          employee,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          `/coverage/${id}/decision`,
          "POST",
          { accepted: true, reason: "I can cover the shift" },
          other,
        )
      ).status,
    ).toBe(200);
    const shift = await env.DB.prepare(
      "SELECT employee_id,kind,overtime_approved FROM scheduled_shifts",
    ).first();
    expect(shift).toMatchObject({
      employee_id: otherId,
      kind: "extra",
      overtime_approved: 1,
    });
    expect((await req("/requests", "POST", absence(), other)).status).toBe(409);
  });
  it("refuses overlapping coverage and requires overtime approval", async () => {
    const absenceId = await create(absence());
    await decision(absenceId);
    await req("/schedules/weekly", "POST", {
      employeeId: otherId,
      weekday: new Date(tomorrow() + "T00:00:00Z").getUTCDay(),
      startMinute: 480,
      endMinute: 720,
      effectiveDate: today(),
      reason: "Normal shift for replacement",
    });
    const data = {
      absenceId,
      employeeId: otherId,
      start: dayStart(tomorrow()) + 9 * 3600,
      end: dayStart(tomorrow()) + 10 * 3600,
      requiresAcceptance: false,
      overtimeApproved: true,
      reason: "Overlapping replacement shift",
    };
    expect(
      (await req("/coverage", "POST", { ...data, overtimeApproved: false }))
        .status,
    ).toBe(400);
    expect((await req("/coverage", "POST", data)).status).toBe(409);
    expect(await count("shift_coverage_assignments")).toBe(0);
  });
  it("verifies webhook secrets without a cookie and deduplicates updates", async () => {
    const update = {
      update_id: 1,
      message: {
        chat: { id: 200001, type: "private" },
        from: { id: 200001 },
        text: "/start",
      },
    };
    const webhook = (secret: string) =>
      app.request(
        "http://127.0.0.1:8787/api/telegram/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": secret,
          },
          body: JSON.stringify(update),
        },
        env,
      );
    expect((await webhook("wrong")).status).toBe(403);
    expect(await count("telegram_chats")).toBe(0);
    expect((await webhook(env.TELEGRAM_WEBHOOK_SECRET!)).status).toBe(200);
    expect((await webhook(env.TELEGRAM_WEBHOOK_SECRET!)).status).toBe(200);
    expect(await count("notification_outbox")).toBe(1);
    expect(await count("telegram_chats")).toBe(1);
  });
  it("claims a notification once under concurrent delivery and retries definite rate limits", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: false },
      employee,
    );
    await env.DB.batch([
      notify(env.DB, "test-event", "Test message", employeeId),
    ]);
    const send = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            parameters: { retry_after: 120 },
          }),
        ),
    );
    await Promise.all([
      deliverNotifications(env, send as typeof fetch),
      deliverNotifications(env, send as typeof fetch),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        "SELECT status,attempts FROM notification_outbox",
      ).first(),
    ).toMatchObject({ status: "pending", attempts: 1 });
    await env.DB.prepare(
      "UPDATE notification_outbox SET next_attempt_at=0",
    ).run();
    send.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    await deliverNotifications(env, send as typeof fetch);
    expect(
      await env.DB.prepare("SELECT status FROM notification_outbox").first(),
    ).toMatchObject({ status: "sent" });
  });
  it("does not retry ambiguous failures or send when notifications are disabled", async () => {
    await req(
      "/notifications/preferences",
      "POST",
      { enabled: true, reminders: false },
      employee,
    );
    await env.DB.batch([
      notify(env.DB, "test-event", "Test message", employeeId),
    ]);
    const send = vi.fn(async () => {
      throw new Error("Network timeout");
    });
    await deliverNotifications(env, send as typeof fetch);
    expect(send).not.toHaveBeenCalled();
    env.NOTIFICATIONS_ENABLED = "true";
    await deliverNotifications(env, send as typeof fetch);
    await deliverNotifications(env, send as typeof fetch);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare("SELECT status FROM notification_outbox").first(),
    ).toMatchObject({ status: "uncertain" });
    expect(await count("employee_requests")).toBe(0);
  });
  it("stages checkout reminders once and suppresses queued alerts after checkout", async () => {
    const s = await messageShift();
    await openMessageSession(s);
    const end = s.start + 8 * 3600;
    const events = async () => (await env.DB.prepare("SELECT event_key FROM notification_outbox WHERE notification_kind='checkout'").all<{event_key:string}>()).results.map((r) => r.event_key);
    await prepareReminders(env, s.start);
    expect(await events()).toHaveLength(0);
    await prepareReminders(env, end);
    await prepareReminders(env, end + 60);
    expect(await events()).toEqual(["checkout-end:message-session"]);
    await prepareReminders(env, end + 1800);
    expect(await events()).toContain("checkout-overdue:message-session");
    expect((await events()).some((e) => e.startsWith("forgotten-admin:"))).toBe(false);
    await prepareReminders(env, end + 3600);
    await prepareReminders(env, end + 3660);
    expect(await events()).toHaveLength(4);
    await env.DB.prepare("UPDATE attendance_sessions SET check_out=? WHERE id='message-session'").bind(end + 3600).run();
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue((end + 3660) * 1000);
    const send = vi.fn(async () => new Response(JSON.stringify({ok:true})));
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    expect((await env.DB.prepare("SELECT status FROM notification_outbox WHERE notification_kind='checkout'").all<{status:string}>()).results.every((r) => r.status === "failed")).toBe(true);
  });
  it("rechecks overtime extensions before delivering a queued checkout reminder", async () => {
    const s = await messageShift();
    await openMessageSession(s);
    const end = s.start + 8 * 3600;
    await prepareReminders(env, end + 1800);
    await env.DB.prepare("INSERT INTO overtime_approvals(id,employee_id,work_date,start_at,end_at,reason,approved_by,created_at) SELECT 'checkout-extension',?,?,?,?,'Test approved extension',id,? FROM users WHERE access='super_admin'").bind(employeeId, s.d, end, end + 7200, s.start).run();
    env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(Date, "now").mockReturnValue((end + 1800) * 1000);
    const send = vi.fn(async () => new Response(JSON.stringify({ok:true})));
    await deliverNotifications(env, send);
    expect(send).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT error_code FROM notification_outbox WHERE event_key='checkout-overdue:message-session'").first()).toMatchObject({ error_code: "stale_checkout" });
    await prepareReminders(env, end + 7200 + 1800);
    expect(await env.DB.prepare("SELECT status FROM notification_outbox WHERE event_key='checkout-overdue:message-session'").first()).toMatchObject({ status: "pending" });
  });
  it("deduplicates forgotten checkout reminders and bounds history queries", async () => {
    await baseSession(true);
    await prepareReminders(env);
    await prepareReminders(env);
    // Two forgotten-checkout alerts plus the Phase 4 daily-review reminder.
    expect(await count("notification_outbox")).toBe(3);
    expect(
      (
        await req(
          "/attendance/history?from=0001-01-01&to=9999-12-31",
          "GET",
          undefined,
          employee,
        )
      ).status,
    ).toBe(400);
  });
});
