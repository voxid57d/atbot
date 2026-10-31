import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import app from "../backend/index";
import type { Bindings } from "../backend/types";
import { localDate } from "../shared/domain";
import { signedLogin } from "./helpers";
let mf: Miniflare, env: Bindings, rootCookie: string;
const today = () => localDate();
const future = () => localDate(Date.now() + 86400000);
function request(
  path: string,
  method = "GET",
  data?: unknown,
  cookie = rootCookie,
  key = crypto.randomUUID(),
  origin = "http://127.0.0.1:5173",
) {
  return app.request(
    "http://127.0.0.1:8787/api" + path,
    {
      method,
      headers: {
        Origin: origin,
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
  const response = await request(
    "/auth/telegram",
    "POST",
    { initData: signedLogin(id) },
    "",
  );
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function setupEmployee(id = 200001) {
  const levelResponse = await request("/roles/office-manager/levels", "POST", {
    name: "Level 1",
    hourlyRate: 12000,
    effectiveDate: today(),
  });
  const level = (await levelResponse.json()) as { id: string };
  expect(levelResponse.status).toBe(201);
  const response = await request("/employees", "POST", {
    fullName: "Employee One",
    telegramId: String(id),
    levelId: level.id,
    activationDate: today(),
  });
  const employee = (await response.json()) as { id: string; userId: string };
  expect(response.status).toBe(201);
  return { ...employee, levelId: level.id };
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
  const db = await mf.getD1Database("DB");
  const sql = readdirSync(new URL("../database/migrations/", import.meta.url))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) =>
      readFileSync(
        new URL("../database/migrations/" + file, import.meta.url),
        "utf8",
      ),
    )
    .join("\n");
  await db.batch(
    sql
      .replace(/--[^\r\n]*/g, "")
      .replace(/CREATE TRIGGER[\s\S]*?\nEND;/g, (block) =>
        block.replaceAll(";", "__SQL_SEMI__"),
      )
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s.replaceAll("__SQL_SEMI__", ";"))),
  );
  env = {
    DB: db as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("test") } as unknown as Fetcher,
    TELEGRAM_BOT_TOKEN: "test-bot-token",
    BOOTSTRAP_TELEGRAM_ID: "100001",
    APP_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:5173",
  };
  const auth = await login(100001);
  expect(auth.response.status).toBe(200);
  rootCookie = auth.cookie;
});
afterEach(async () => {
  await mf?.dispose();
});

describe("Phase 6 release protections", () => {
  it.each([
    ["cross-origin", "https://example.invalid", "application/json", "{}", 403],
    ["missing-origin", "", "application/json", "{}", 403],
    ["content-type", "https://app.example", "text/plain", "{}", 415],
    [
      "body-size",
      "https://app.example",
      "application/json",
      "x".repeat(17000),
      413,
    ],
    ["webhook-secret", "", "application/json", "{}", 403],
  ])(
    "protects %s errors with private HTTPS headers",
    async (kind, origin, contentType, data, status) => {
      env.APP_ENV = "production";
      env.APP_ORIGIN = "https://app.example";
      env.TELEGRAM_WEBHOOK_SECRET = "local-only-secret";
      const path =
        kind === "webhook-secret"
          ? "/api/telegram/webhook"
          : "/api/auth/telegram";
      const r = await app.request(
        "https://app.example" + path,
        {
          method: "POST",
          headers: {
            Origin: String(origin),
            "Content-Type": String(contentType),
          },
          body: String(data),
        },
        env,
      );
      expect(r.status).toBe(status);
      expect(r.headers.get("Cache-Control")).toBe("no-store");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("Strict-Transport-Security")).toContain("max-age=");
      expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(r.headers.get("Set-Cookie")).toBeNull();
    },
  );
  it("reports readiness only with all implemented schema present", async () => {
    const r = await request("/health", "GET", undefined, "");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok", phase: 6 });
  });
  it("fails health safely when payroll snapshot storage is missing", async () => {
    await env.DB.prepare("DROP TABLE payroll_snapshots").run();
    const r = await request("/health", "GET", undefined, "");
    expect(r.status).toBe(503);
    expect((await r.json()) as { error: string }).toEqual({
      error:
        "The service is temporarily unavailable. No success was confirmed; retry safely.",
    });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
});
describe("Phase 1 API with real local D1", () => {
  it("rejects a shared owner cookie when the signed Telegram account differs", async () => {
    const res = await app.request(
      "http://127.0.0.1:8787/api/admin/users",
      {
        headers: {
          Cookie: rootCookie,
          "X-Telegram-Init-Data": signedLogin(200001),
        },
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("super_admin");
    const write = await app.request(
      "http://127.0.0.1:8787/api/roles",
      {
        method: "POST",
        headers: {
          Cookie: rootCookie,
          Origin: env.APP_ORIGIN,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Telegram-Init-Data": signedLogin(200001),
        },
        body: JSON.stringify({ name: "Unauthorized role" }),
      },
      env,
    );
    expect(write.status).toBe(401);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM roles WHERE name='Unauthorized role'",
      ).first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it("clears the previous owner session when switching to an unregistered Telegram account", async () => {
    const res = await request("/auth/telegram", "POST", {
      initData: signedLogin(200001),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await request("/me")).status).toBe(401);
  });
  it("switches a shared cookie to the registered employee without owner permissions", async () => {
    await setupEmployee();
    const res = await request("/auth/telegram", "POST", {
      initData: signedLogin(200001),
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { user: { access: string } }).user.access,
    ).toBe("employee");
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    expect(
      (await request("/admin/users", "GET", undefined, cookie)).status,
    ).toBe(403);
    expect((await request("/me")).status).toBe(401);
  });
  it("resumes the same signed launch on reload without consuming it twice", async () => {
    const initData = signedLogin(),
      first = await request("/auth/telegram", "POST", { initData }, ""),
      cookie = first.headers.get("set-cookie")!.split(";")[0];
    expect(first.status).toBe(200);
    const resumed = await request(
      "/auth/telegram",
      "POST",
      { initData },
      cookie,
    );
    expect(resumed.status).toBe(200);
    expect(resumed.headers.get("set-cookie")).toBeNull();
    expect(
      (await request("/auth/telegram", "POST", { initData }, "")).status,
    ).toBe(409);
  });
  it("permits an older matching launch only with a live session, never for a new login", async () => {
    const old = signedLogin(100001, Math.floor(Date.now() / 1000) - 600);
    expect(
      (await request("/auth/telegram", "POST", { initData: old })).status,
    ).toBe(200);
    expect(
      (await request("/auth/telegram", "POST", { initData: old }, "")).status,
    ).toBe(401);
  });
  it("rejects tampered launch data even when an owner cookie is valid", async () => {
    const altered = new URLSearchParams(signedLogin());
    altered.set("user", JSON.stringify({ id: 200001 }));
    const res = await app.request(
      "http://127.0.0.1:8787/api/me",
      {
        headers: {
          Cookie: rootCookie,
          "X-Telegram-Init-Data": altered.toString(),
        },
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(
      (
        await request("/auth/telegram", "POST", {
          initData: altered.toString(),
        })
      ).status,
    ).toBe(401);
    expect((await request("/me")).status).toBe(401);
  });
  it("requires signed launch data with every production session request", async () => {
    env.APP_ENV = "production";
    env.APP_ORIGIN = "https://app.example";
    const initData = signedLogin();
    const auth = await app.request(
      env.APP_ORIGIN + "/api/auth/telegram",
      {
        method: "POST",
        headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      },
      env,
    );
    const cookie = auth.headers.get("set-cookie")!.split(";")[0];
    expect(auth.status).toBe(200);
    const res = await app.request(
      env.APP_ORIGIN + "/api/me",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(401);
    const valid = await app.request(
      env.APP_ORIGIN + "/api/me",
      { headers: { Cookie: cookie, "X-Telegram-Init-Data": initData } },
      env,
    );
    expect(valid.status).toBe(200);
    const mismatch = await app.request(
      env.APP_ORIGIN + "/api/me",
      {
        headers: {
          Cookie: cookie,
          "X-Telegram-Init-Data": signedLogin(200001),
        },
      },
      env,
    );
    expect(mismatch.status).toBe(401);
  });
  it("rejects oversized request bodies", async () => {
    expect(
      (await request("/roles", "POST", { name: "x".repeat(17000) })).status,
    ).toBe(413);
  });
  it("does not create another bootstrap owner after the secret changes", async () => {
    env.BOOTSTRAP_TELEGRAM_ID = "300001";
    expect((await login(300001)).response.status).toBe(403);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM users WHERE access='super_admin'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("rejects expired server sessions", async () => {
    await env.DB.prepare("UPDATE auth_sessions SET expires_at=0").run();
    expect((await request("/me")).status).toBe(401);
  });
  it("does not relax HTTPS when a non-local deployment is misconfigured as development", async () => {
    const response = await app.request(
      "http://app.example/api/health",
      {},
      env,
    );
    expect(response.status).toBe(400);
  });
  it("records the previous permissions when administrator access changes", async () => {
    const e = await setupEmployee();
    await request(`/admin/users/${e.userId}/access`, "POST", {
      access: "admin",
      permissions: ["employees.manage"],
      reason: "Grant onboarding access",
    });
    await request(`/admin/users/${e.userId}/access`, "POST", {
      access: "admin",
      permissions: ["salary.manage"],
      reason: "Change administrator responsibility",
    });
    const event = await env.DB.prepare(
      "SELECT before_json FROM audit_logs WHERE action='admin.access.change' AND reason=?",
    )
      .bind("Change administrator responsibility")
      .first<{ before_json: string }>();
    expect(JSON.parse(event!.before_json).permissions).toEqual([
      "employees.manage",
    ]);
  });
  it("bootstraps exactly one super administrator and sets an HttpOnly cookie", async () => {
    const auth = await login(100001);
    expect(auth.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(auth.response.headers.get("set-cookie")).toContain(
      "SameSite=Strict",
    );
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM bootstrap_state").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it("rejects unauthenticated private data and unknown Telegram accounts", async () => {
    expect((await request("/employees", "GET", undefined, "")).status).toBe(
      401,
    );
    expect((await login(777777)).response.status).toBe(403);
  });
  it("rejects login replay and origin attacks", async () => {
    const data = { initData: signedLogin() };
    expect((await request("/auth/telegram", "POST", data, "")).status).toBe(
      200,
    );
    expect((await request("/auth/telegram", "POST", data, "")).status).toBe(
      409,
    );
    expect(
      (
        await request(
          "/roles",
          "POST",
          { name: "Attack" },
          rootCookie,
          crypto.randomUUID(),
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
  it("isolates employee data and rejects employee management calls", async () => {
    await setupEmployee();
    const { cookie } = await login(200001);
    const me = (await (
      await request("/me", "GET", undefined, cookie)
    ).json()) as { employee: { telegram_id: string } };
    expect(me.employee.telegram_id).toBe("200001");
    expect((await request("/employees", "GET", undefined, cookie)).status).toBe(
      403,
    );
    expect(
      (await request("/roles", "POST", { name: "Escalate" }, cookie)).status,
    ).toBe(403);
    expect(
      (await request("/admin/users", "GET", undefined, cookie)).status,
    ).toBe(403);
    const catalog = (await (
      await request("/catalog", "GET", undefined, cookie)
    ).json()) as { levels: Record<string, unknown>[] };
    expect(catalog.levels[0]).not.toHaveProperty("hourly_rate");
  });
  it("repeated employee creation returns the same record and one audit event", async () => {
    const { levelId } = await setupEmployee();
    const input = {
        fullName: "Employee Two",
        telegramId: "200002",
        levelId,
        activationDate: today(),
      },
      key = crypto.randomUUID();
    const first = await request("/employees", "POST", input, rootCookie, key);
    const second = await request("/employees", "POST", input, rootCookie, key);
    expect(await second.json()).toEqual(await first.json());
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM users WHERE telegram_id='200002'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM audit_logs WHERE action='employee.create'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(2);
  });
  it("concurrent duplicate writes commit one result", async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all([
      request("/roles", "POST", { name: "Tutor" }, rootCookie, key),
      request("/roles", "POST", { name: "Tutor" }, rootCookie, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM roles WHERE name='Tutor'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("rejects reused idempotency keys with a different payload", async () => {
    const key = crypto.randomUUID();
    await request("/roles", "POST", { name: "Role One" }, rootCookie, key);
    expect(
      (await request("/roles", "POST", { name: "Role Two" }, rootCookie, key))
        .status,
    ).toBe(409);
  });
  it("rolls back employee creation and audit on duplicate Telegram identity", async () => {
    const { levelId } = await setupEmployee();
    expect(
      (
        await request("/employees", "POST", {
          fullName: "Duplicate",
          telegramId: "200001",
          levelId,
          activationDate: today(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM employees").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it("stores historical integer rates without replacing earlier earnings rates", async () => {
    const { levelId } = await setupEmployee();
    expect(
      (
        await request(`/levels/${levelId}/rates`, "POST", {
          hourlyRate: 13000,
          effectiveDate: future(),
          reason: "Scheduled annual change",
        })
      ).status,
    ).toBe(201);
    const rates = (
      await env.DB.prepare(
        "SELECT hourly_rate,effective_date FROM hourly_rate_history WHERE level_id=? ORDER BY effective_date",
      )
        .bind(levelId)
        .all()
    ).results;
    expect(rates).toEqual([
      { hourly_rate: 12000, effective_date: today() },
      { hourly_rate: 13000, effective_date: future() },
    ]);
    const employees = (await (await request("/employees")).json()) as {
      employees: { hourly_rate: number }[];
    };
    expect(employees.employees[0].hourly_rate).toBe(12000);
  });
  it("rejects retroactive and same-date rate replacement", async () => {
    const { levelId } = await setupEmployee();
    expect(
      (
        await request(`/levels/${levelId}/rates`, "POST", {
          hourlyRate: 13000,
          effectiveDate: "2020-01-01",
          reason: "Retroactive rate change",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/levels/${levelId}/rates`, "POST", {
          hourlyRate: 13000,
          effectiveDate: today(),
          reason: "Replace existing rate",
        })
      ).status,
    ).toBe(409);
  });
  it("revokes sessions when disabled and does not re-bootstrap disabled users", async () => {
    const e = await setupEmployee();
    const auth = await login(200001);
    expect(
      (
        await request(`/employees/${e.id}`, "PATCH", {
          active: false,
          reason: "Employment ended",
        })
      ).status,
    ).toBe(200);
    expect((await request("/me", "GET", undefined, auth.cookie)).status).toBe(
      401,
    );
    expect((await login(200001)).response.status).toBe(403);
    await env.DB.prepare(
      "UPDATE users SET active=0 WHERE telegram_id='100001'",
    ).run();
    expect((await login(100001)).response.status).toBe(403);
  });
  it("renames without revoking sessions or touching an unchanged status", async () => {
    const e = await setupEmployee();
    const auth = await login(200001);
    expect(
      (
        await request(`/employees/${e.id}`, "PATCH", {
          fullName: "Employee Renamed",
          active: true,
          reason: "",
        })
      ).status,
    ).toBe(200);
    expect((await request("/me", "GET", undefined, auth.cookie)).status).toBe(
      200,
    );
    await request(`/employees/${e.id}`, "PATCH", { active: false, reason: "" });
    await env.DB.prepare(
      "UPDATE employees SET activation_date='2026-01-01',deactivation_date='2026-01-15' WHERE id=?",
    )
      .bind(e.id)
      .run();
    expect(
      (
        await request(`/employees/${e.id}`, "PATCH", {
          fullName: "Employee Former",
          active: false,
          reason: "",
        })
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT deactivation_date FROM employees WHERE id=?",
      )
        .bind(e.id)
        .first(),
    ).toEqual({ deactivation_date: "2026-01-15" });
    expect(
      (
        await request(`/employees/${e.id}`, "PATCH", {
          active: false,
          reason: "",
        })
      ).status,
    ).toBe(400);
  });
  it("redirects app pages from the old host but keeps reception, assets and the webhook", async () => {
    env.APP_ENV = "production";
    env.APP_ORIGIN = "https://staff.example";
    const old = "https://old.workers.example";
    const page = await app.request(old + "/?tab=1", {}, env);
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe("https://staff.example/?tab=1");
    for (const path of ["/reception/", "/assets/index.js", "/brand/icon.svg"])
      expect((await app.request(old + path, {}, env)).status).toBe(200);
    expect((await app.request("https://staff.example/", {}, env)).status).toBe(
      200,
    );
    expect(
      (await app.request(old + "/api/telegram/webhook", { method: "POST" }, env))
        .status,
    ).toBe(403);
  });
  it("blocks not-yet-active employee login", async () => {
    const { levelId } = await setupEmployee();
    await request("/employees", "POST", {
      fullName: "Future Employee",
      telegramId: "200002",
      levelId,
      activationDate: future(),
    });
    expect((await login(200002)).response.status).toBe(403);
  });
  it("relinks Telegram identity with an audit reason and revokes old sessions", async () => {
    const e = await setupEmployee();
    const old = await login(200001);
    expect(
      (
        await request(`/employees/${e.id}/telegram`, "POST", {
          telegramId: "200002",
          reason: "Verified replacement Telegram account",
        })
      ).status,
    ).toBe(200);
    expect((await request("/me", "GET", undefined, old.cookie)).status).toBe(
      401,
    );
    expect((await login(200001)).response.status).toBe(403);
    expect((await login(200002)).response.status).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT reason FROM audit_logs WHERE action='employee.telegram.change'",
        ).first<{ reason: string }>()
      )?.reason,
    ).toContain("Verified");
  });
  it("grants selected admin permissions without granting salary or payroll rights", async () => {
    const e = await setupEmployee();
    await request(`/admin/users/${e.userId}/access`, "POST", {
      access: "admin",
      permissions: ["employees.manage"],
      reason: "Delegate employee onboarding",
    });
    const { cookie } = await login(200001);
    expect((await request("/employees", "GET", undefined, cookie)).status).toBe(
      200,
    );
    const data = (await (
      await request("/employees", "GET", undefined, cookie)
    ).json()) as { employees: Record<string, unknown>[] };
    expect(data.employees[0]).not.toHaveProperty("hourly_rate");
    expect(
      (
        await request(
          "/roles",
          "POST",
          { name: "Unauthorized wage role" },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/admin/users/${e.userId}/access`,
          "POST",
          {
            access: "admin",
            permissions: ["salary.manage"],
            reason: "Self escalate permissions",
          },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect((await request("/audit", "GET", undefined, cookie)).status).toBe(
      403,
    );
  });
  it("preserves old assignments when scheduling a new level", async () => {
    const e = await setupEmployee();
    const newLevel = (await (
      await request("/roles/cashier/levels", "POST", {
        name: "Level 1",
        hourlyRate: 10000,
        effectiveDate: today(),
      })
    ).json()) as { id: string };
    expect(
      (
        await request(`/employees/${e.id}`, "PATCH", {
          levelId: newLevel.id,
          effectiveDate: future(),
          reason: "New assignment next day",
        })
      ).status,
    ).toBe(200);
    const data = (await (
      await request(`/employees/${e.id}/history`)
    ).json()) as { assignments: unknown[] };
    expect(data.assignments).toHaveLength(2);
  });
  it("renames and deactivates catalog records without deleting history", async () => {
    const { levelId } = await setupEmployee();
    expect(
      (
        await request(`/levels/${levelId}`, "PATCH", {
          name: "Junior",
          active: false,
          reason: "Catalog consolidation",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM hourly_rate_history WHERE level_id=?",
        )
          .bind(levelId)
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await request("/employees", "POST", {
          fullName: "Another Employee",
          telegramId: "200002",
          levelId,
          activationDate: today(),
        })
      ).status,
    ).toBe(400);
  });
  it("requires idempotency keys and rejects invalid input", async () => {
    const response = await app.request(
      "http://127.0.0.1:8787/api/roles",
      {
        method: "POST",
        headers: {
          Origin: env.APP_ORIGIN,
          "Content-Type": "application/json",
          Cookie: rootCookie,
        },
        body: JSON.stringify({ name: "No key role" }),
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(
      (
        await request("/roles/office-manager/levels", "POST", {
          name: "Bad Rate",
          hourlyRate: 12000.5,
          effectiveDate: today(),
        })
      ).status,
    ).toBe(400);
  });
  it("limits authentication attempts", async () => {
    // A real minute boundary during the request loop must not reset the test's
    // rate-limit window. The application still uses its real fixed windows.
    const timestamp = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(timestamp);
    try {
      const statuses = [];
      for (let i = 0; i < 21; i++) statuses.push((await login(777777)).response.status);
      expect(statuses.at(-1)).toBe(429);
      clock.mockReturnValue(timestamp + 60000);
      expect((await login(777777)).response.status).toBe(403);
    } finally { clock.mockRestore(); }
  });
  it("invalidates a logged out session", async () => {
    expect((await request("/auth/logout", "POST", {})).status).toBe(200);
    expect((await request("/me")).status).toBe(401);
  });
  it("cannot demote the bootstrap super administrator", async () => {
    const me = (await (await request("/me")).json()) as {
      user: { id: string };
    };
    expect(
      (
        await request(`/admin/users/${me.user.id}/access`, "POST", {
          access: "employee",
          permissions: [],
          reason: "Accidental self demotion",
        })
      ).status,
    ).toBe(400);
  });
  it("uses Secure host cookies and HTTPS in production", async () => {
    env.APP_ENV = "production";
    env.APP_ORIGIN = "https://app.example";
    const res = await app.request(
      "https://app.example/api/auth/telegram",
      {
        method: "POST",
        headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ initData: signedLogin() }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__Host-atbot_session=");
    expect(res.headers.get("set-cookie")).toContain("Secure");
    expect((await request("/me")).status).toBe(400);
  });
});
