import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import app from "../backend/index";
import type { Bindings } from "../backend/types";
import { localDate } from "../shared/domain";
import { dayStart } from "../shared/attendance";
import { signedLogin, testBotToken } from "./helpers";
let mf: Miniflare,
  env: Bindings,
  root: string,
  employee: string,
  other: string,
  eid: string,
  oid: string,
  rootId: string,
  employeeUser: string;
const today = () => localDate(),
  past = () => {
    const [y, m] = today().split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 10);
  };
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
async function preview(d = past(), cookie = root) {
  const r = await req(
    "/payroll/preview?periodDate=" + d,
    "GET",
    undefined,
    cookie,
  );
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as any;
}
async function review() {
  const r = await req("/discipline/review?periodDate=" + past());
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as any;
}
async function recorded(d = past(), end = 17 * 3600, late = 0) {
  const shift = crypto.randomUUID(),
    session = crypto.randomUUID(),
    start = dayStart(d);
  await env.DB.prepare(
    "INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,created_at) VALUES(?,?,?,?,?,'regular','scheduled',?)",
  )
    .bind(
      shift,
      eid,
      d,
      start + 8 * 3600,
      start + 17 * 3600,
      Math.floor(Date.now() / 1000),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES(?,?,?,?,?,?,'tablet',?)",
  )
    .bind(
      session,
      eid,
      d,
      shift,
      start + 8 * 3600 + late,
      end === 0 ? null : start + end,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return { shift, session };
}
async function ready() {
  const s = await recorded();
  let d = await review();
  expect(
    (
      await req("/discipline/quality", "POST", {
        employeeId: eid,
        date: past(),
        revision: d.revision,
        rating: "good",
        comment: "",
        reason: "Explicit daily work review",
      })
    ).status,
  ).toBe(200);
  await env.DB.prepare(
    "INSERT INTO daily_uniform_confirmations(employee_id,work_date,declared_at) VALUES(?,?,?)",
  )
    .bind(eid, past(), dayStart(past()) + 8 * 3600)
    .run();
  d = await review();
  expect(
    (
      await req("/discipline/uniform/decision", "POST", {
        employeeId: eid,
        date: past(),
        revision: d.revision,
        status: "approved",
        reason: "Uniform confirmed for fixture",
      })
    ).status,
  ).toBe(200);
  return s;
}
async function propose(kind = "bonus", amount = 10000, date = past()) {
  const d = await preview();
  const r = await req("/payroll/adjustments", "POST", {
    employeeId: eid,
    date,
    kind,
    amount,
    revision: d.revision,
    reason: "Audited payroll adjustment",
  });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as any).id;
}
async function adjust(id: string, status = "approved") {
  const d = await preview();
  return req(`/payroll/adjustments/${id}/decision`, "POST", {
    status,
    revision: d.revision,
    reason: "Explicit payroll approval",
  });
}
async function finalize() {
  const d = await preview();
  return req("/payroll/finalize", "POST", {
    periodDate: past(),
    revision: d.revision,
    reason: "Monthly payroll reviewed",
  });
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
    NOTIFICATIONS_ENABLED: "false",
    TELEGRAM_WEBHOOK_SECRET: "test-webhook",
  };
  root = await login(100001);
  rootId = ((await (await req("/me")).json()) as any).user.id;
  const level = (
    (await (
      await req("/roles/office-manager/levels", "POST", {
        name: "Test",
        hourlyRate: 12000,
        effectiveDate: today(),
      })
    ).json()) as any
  ).id;
  for (const id of [200001, 200002]) {
    const r = await req("/employees", "POST", {
      fullName: `Employee ${id}`,
      telegramId: String(id),
      levelId: level,
      activationDate: today(),
    });
    expect(r.status).toBe(201);
    const e = (await r.json()) as any;
    if (id === 200001) {
      eid = e.id;
      employeeUser = e.userId;
    } else oid = e.id;
  }
  await db.batch([
    db.prepare("UPDATE employees SET activation_date='2026-01-01'"),
    db.prepare("UPDATE employee_role_history SET effective_date='2026-01-01'"),
    db.prepare("UPDATE hourly_rate_history SET effective_date='2026-01-01'"),
  ]);
  employee = await login(200001);
  other = await login(200002);
  await db
    .prepare(
      "INSERT INTO registered_tablets(id,name,credential_hash,credential_expires_at,created_by,created_at) VALUES('tablet','Test','fake',?,?,?)",
    )
    .bind(
      Math.floor(Date.now() / 1000) + 3600,
      rootId,
      Math.floor(Date.now() / 1000),
    )
    .run();
});
afterEach(async () => {
  await mf?.dispose();
  vi.restoreAllMocks();
});
async function makeCashier(id = eid) {
  const r = await req("/roles/cashier/levels", "POST", { name: `Cashier ${id}`, hourlyRate: 12000, effectiveDate: today() });
  expect(r.status).toBe(201);
  const level = ((await r.json()) as any).id;
  await env.DB.prepare("UPDATE employee_role_history SET level_id=? WHERE employee_id=?").bind(level, id).run();
}
async function debtorData(cookie = root) {
  const r = await req("/debtors", "GET", undefined, cookie);
  expect(r.status).toBe(200);
  return await r.json() as any;
}
const counts = (debtors = 8) => ({ d1: debtors, d2: 0, d3: 0, d4: 0, s1: 100, s2: 0, s3: 0 });
describe("Cashier shared debt bonus on isolated D1", () => {
  it("applies the shared multiplier to the whole month's cashier earnings and excludes work in other roles", async () => {
    await makeCashier();
    await env.DB.prepare("UPDATE hourly_rate_history SET effective_date='2026-01-01' WHERE level_id IN (SELECT id FROM role_levels WHERE role_id='cashier')").run();
    const cashier = await env.DB.prepare("SELECT level_id FROM employee_role_history WHERE employee_id=?").bind(eid).first<any>();
    const office = await env.DB.prepare("SELECT level_id FROM employee_role_history WHERE employee_id=?").bind(oid).first<any>();
    for (const [effective, level] of [["2026-10-14", office.level_id], ["2026-10-15", cashier.level_id]])
      await env.DB.prepare("INSERT INTO employee_role_history(id,employee_id,level_id,effective_date,created_by,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),eid,level,effective,rootId,dayStart(effective)).run();
    await recorded("2026-10-01");
    await recorded("2026-10-14");
    await recorded("2026-10-15");
    await env.DB.prepare("INSERT INTO debtor_entries(work_date,d1,d2,d3,d4,s1,s2,s3,created_by,created_at) VALUES('2026-10-15',8,0,0,0,100,0,0,?,?)").bind(rootId,dayStart("2026-10-15")).run();
    const d = await preview("2026-10-15");
    expect(d.entries.find((e: any) => e.employeeId === eid)).toMatchObject({ workedGross: 324000,
      cashierBonus: { eligibleEarnings: 216000, amount: 129600 }, finalPay: 453600 });
    const next = await preview("2026-11-15");
    expect(next.entries.find((e: any) => e.employeeId === eid).cashierBonus).toMatchObject({ multiplier: 1.6, entryDate: "2026-10-15" });
  });
  it("restricts entry access, validates counts, audits and deduplicates writes, and rejects stale saves", async () => {
    expect((await req("/debtors", "GET", undefined, employee)).status).toBe(403);
    expect((await req("/debtors", "POST", { ...counts(), revision: 0 }, employee)).status).toBe(403);
    await makeCashier();
    const data = await debtorData(employee);
    expect((await req("/debtors", "POST", { ...counts(), s1: 0, revision: data.revision }, employee)).status).toBe(400);
    expect((await req("/debtors", "POST", { ...counts(), d1: -1, revision: data.revision }, employee)).status).toBe(400);
    expect((await req("/debtors", "POST", { ...counts(), d1: 1.5, revision: data.revision }, employee)).status).toBe(400);
    const input = { ...counts(), revision: data.revision }, key = crypto.randomUUID();
    expect((await req("/debtors", "POST", input, employee, key)).status).toBe(201);
    expect((await req("/debtors", "POST", input, employee, key)).status).toBe(201);
    expect((await req("/debtors", "POST", input, employee)).status).toBe(409);
    expect((await debtorData(employee)).history).toHaveLength(1);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='debtors.record'").first<any>()).toMatchObject({ n: 1 });
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=(SELECT user_id FROM employees WHERE id=?)").bind(oid).run();
    expect((await req("/debtors", "GET", undefined, other)).status).toBe(200);
    const adminData = await debtorData(other);
    expect((await req("/debtors", "POST", { ...counts(5), revision: adminData.revision }, other)).status).toBe(201);
    expect((await req("/payroll/preview", "GET", undefined, employee)).status).toBe(403);
    await expect(env.DB.prepare("UPDATE debtor_entries SET d1=0").run()).rejects.toThrow();
    await expect(env.DB.prepare("DELETE FROM debtor_entries").run()).rejects.toThrow();
  });
  it("includes extended hours and approved overtime, excludes adjustments from the bonus base, and uses the latest shared entry", async () => {
    await makeCashier();
    await makeCashier(oid);
    await recorded(today(), 19 * 3600);
    expect((await req("/roles/cashier/daily-pay", "POST", { enabled: true, thresholdMinutes: 480, hourlyRate: 20000, effectiveDate: today(), reason: "" })).status).toBe(201);
    const start = dayStart(today());
    await env.DB.prepare("INSERT INTO overtime_approvals(id,employee_id,work_date,start_at,end_at,reason,approved_by,created_at) VALUES(?,?,?,?,?,'Test',?,?)")
      .bind(crypto.randomUUID(), eid, today(), start+17*3600, start+19*3600, rootId, start).run();
    for (const [kind, amount] of [["deduction",10000],["bonus",5000],["leave_pay",3000]] as const)
      await env.DB.prepare("INSERT INTO payroll_adjustments(id,employee_id,work_date,kind,amount,reason,created_by,created_at,status) VALUES(?,?,?,?,?,'Test',?,?,'approved')")
        .bind(crypto.randomUUID(),eid,today(),kind,amount,rootId,start).run();
    let d = await preview(today());
    expect(d.warnings.some((w: any) => w.kind === "missing_debt_entry")).toBe(true);
    const data = await debtorData(employee);
    expect((await req("/debtors", "POST", { ...counts(), revision: data.revision }, employee)).status).toBe(201);
    d = await preview(today());
    const e = d.entries.find((e: any) => e.employeeId === eid);
    expect(e).toMatchObject({ workedGross: 156000, bonuses: 98600, leavePay: 3000, deductions: 10000, finalPay: 247600,
      cashierBonus: { eligibleEarnings: 156000, multiplier: 1.6, amount: 93600 } });
    expect(d.warnings.some((w: any) => w.kind === "missing_debt_entry")).toBe(false);
    expect(d.entries.find((e: any) => e.employeeId === oid).cashierBonus.multiplier).toBe(1.6);
    const mine = await (await req("/payroll/mine", "GET", undefined, employee)).json() as any;
    expect(mine.entry.employeeId).toBe(eid);
    expect(JSON.stringify(mine)).not.toContain(oid);
    const next = await debtorData();
    expect((await req("/debtors", "POST", { ...counts(30), revision: next.revision })).status).toBe(201);
    const changed = await preview(today());
    expect(changed.entries.find((e: any) => e.employeeId === eid)).toMatchObject({ finalPay: 154000, cashierBonus: { amount: 0, multiplier: 1 } });
    const daily = await debtorData();
    expect(daily.history).toHaveLength(1);
    expect(daily.history[0].d1).toBe(30);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM debtor_entries").first<any>()).toMatchObject({ n: 2 });
    expect((await preview(past())).entries.every((e: any) => e.cashierBonus === null)).toBe(true);
  });
  it("preserves approved snapshots and rejects debt writes into locked payroll", async () => {
    await makeCashier();
    await recorded(today());
    const data = await debtorData();
    expect((await req("/debtors", "POST", { ...counts(2), revision: data.revision })).status).toBe(201);
    const d = await preview(today());
    await env.DB.prepare("INSERT INTO payroll_periods(id,from_date,to_date,status,snapshot_version) VALUES(?,?,?,'finalized',1)").bind(d.id,d.period.from,d.period.to).run();
    await env.DB.prepare("INSERT INTO payroll_snapshots(period_id,version,payload_json,approved_by,approved_at,reason) VALUES(?,1,?,?,?,'Fixture snapshot')").bind(d.id,JSON.stringify(d),rootId,Math.floor(Date.now()/1000)).run();
    await env.DB.prepare("INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES(?,?,?,?,?)").bind(d.id,d.period.from,d.period.to,rootId,Math.floor(Date.now()/1000)).run();
    const locked = await debtorData();
    expect(locked.locked).toBe(true);
    expect((await req("/debtors", "POST", { ...counts(0), revision: locked.revision })).status).toBe(409);
    const finalized = await preview(today());
    expect(finalized.status).toBe("finalized");
    expect(finalized.entries).toEqual(d.entries);
    const csv = await (await req("/payroll/export?periodDate=" + today())).text();
    expect(csv).toContain("Cashier debt bonus UZS (included in bonus)");
    expect(csv).toContain('"1.8"');
    expect((await debtorData()).history).toHaveLength(1);
  });
});
describe("Phase 5 payroll on isolated D1", () => {
  it("waits until today's last regular shift ends before asking for a no-attendance decision", async () => {
    const date = today(), start = dayStart(date);
    expect((await req("/schedules/override", "POST", { employeeId: eid, date, startMinute: 480, endMinute: 600,
      secondStartMinute: 840, secondEndMinute: 1080 })).status).toBe(200);
    const clock = vi.spyOn(Date, "now");
    for (const hour of [7, 11, 15, 17]) {
      clock.mockReturnValue((start + hour * 3600) * 1000);
      expect((await preview(date)).warnings.some((w: any) => w.kind === "unworked_day" && w.date === date)).toBe(false);
    }
    clock.mockReturnValue((start + 18 * 3600) * 1000);
    expect((await preview(date)).warnings.some((w: any) => w.kind === "unworked_day" && w.date === date)).toBe(true);
  });
  it("configures daily role rates with permission checks, preserves history and updates both employee views", async () => {
    await recorded(today());
    const input = {
      enabled: true,
      thresholdMinutes: 480,
      hourlyRate: 20000,
      effectiveDate: today(),
      reason: "",
    };
    expect(
      (await req("/roles/office-manager/daily-pay", "POST", input, employee))
        .status,
    ).toBe(403);
    expect(
      (await req("/roles/office-manager/daily-pay", "GET", undefined, employee))
        .status,
    ).toBe(403);
    expect(
      (
        await req("/roles/office-manager/daily-pay", "POST", {
          ...input,
          hourlyRate: undefined,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/roles/office-manager/daily-pay", "POST", {
          ...input,
          effectiveDate: past(),
        })
      ).status,
    ).toBe(400);
    const key = crypto.randomUUID();
    expect(
      (await req("/roles/office-manager/daily-pay", "POST", input, root, key))
        .status,
    ).toBe(201);
    expect(
      (await req("/roles/office-manager/daily-pay", "POST", input, root, key))
        .status,
    ).toBe(201);
    expect(
      (await preview(today())).entries.find((e: any) => e.employeeId === eid)
        .workedGross,
    ).toBe(116000);
    const mine = (await (
      await req("/attendance/mine", "GET", undefined, employee)
    ).json()) as any;
    expect(mine.summary.estimatedGross).toBe(116000);
    const ownSalary = (await (
      await req(
        "/payroll/mine?periodDate=" + today(),
        "GET",
        undefined,
        employee,
      )
    ).json()) as any;
    expect(ownSalary.entry.workedGross).toBe(116000);
    expect(
      (
        await req("/roles/office-manager/daily-pay", "POST", {
          enabled: false,
          effectiveDate: today(),
          reason: "",
        })
      ).status,
    ).toBe(201);
    const history = (await (
      await req("/roles/office-manager/daily-pay")
    ).json()) as any;
    expect(history.history).toHaveLength(2);
    expect(
      (await preview(today())).entries.find((e: any) => e.employeeId === eid)
        .workedGross,
    ).toBe(108000);
  });
  it("keeps earlier earnings unchanged when a role rule has a future effective date", async () => {
    await recorded(past());
    const future = localDate(Date.now() + 86400000);
    expect(
      (
        await req("/roles/office-manager/daily-pay", "POST", {
          enabled: true,
          thresholdMinutes: 480,
          hourlyRate: 20000,
          effectiveDate: future,
        })
      ).status,
    ).toBe(201);
    expect(
      (await preview()).entries.find((e: any) => e.employeeId === eid)
        .workedGross,
    ).toBe(108000);
    await expect(
      env.DB.prepare("UPDATE role_daily_pay_history SET hourly_rate=1").run(),
    ).rejects.toThrow();
  });
  it("blocks finalization until every mandatory daily review is explicit", async () => {
    await recorded();
    const d = await preview();
    expect(d.warnings.map((w: any) => w.kind)).toEqual(
      expect.arrayContaining(["quality_review", "uniform_review"]),
    );
    expect((await finalize()).status).toBe(409);
  });
  it("only approved adjustments affect pay and rejected/reversed ones do not", async () => {
    await ready();
    let d = await preview();
    expect(d.entries.find((e: any) => e.employeeId === eid).finalPay).toBe(
      108000,
    );
    const id = await propose();
    d = await preview();
    expect(d.warnings.some((w: any) => w.kind === "pending_adjustment")).toBe(
      true,
    );
    expect(d.entries.find((e: any) => e.employeeId === eid).finalPay).toBe(
      108000,
    );
    expect((await adjust(id)).status).toBe(200);
    expect(
      (await preview()).entries.find((e: any) => e.employeeId === eid).finalPay,
    ).toBe(118000);
    expect((await adjust(id, "reversed")).status).toBe(200);
    expect(
      (await preview()).entries.find((e: any) => e.employeeId === eid).finalPay,
    ).toBe(108000);
  });
  it("requires manual approved leave pay for paid absences and permits explicit zero settlement", async () => {
    const d = await req(
      "/requests",
      "POST",
      {
        kind: "absence",
        date: past(),
        category: "sick",
        reason: "Test paid absence",
      },
      employee,
    );
    expect(d.status).toBe(201);
    const id = ((await d.json()) as any).id;
    await env.DB.prepare(
      "UPDATE absence_categories SET paid=1 WHERE id='sick'",
    ).run();
    expect(
      (
        await req(`/requests/${id}/decision`, "POST", {
          approved: true,
          reason: "Approved paid absence",
        })
      ).status,
    ).toBe(200);
    expect(
      (await preview()).warnings.some((w: any) => w.kind === "paid_leave"),
    ).toBe(true);
    const a = await propose("leave_pay", 0);
    expect((await adjust(a)).status).toBe(200);
    const p = await preview();
    expect(p.warnings.some((w: any) => w.kind === "paid_leave")).toBe(false);
    expect(p.entries.find((e: any) => e.employeeId === eid).leavePay).toBe(0);
  });
  it("rejects leave-pay adjustments without an approved paid absence", async () => {
    const d = await preview();
    expect(
      (
        await req("/payroll/adjustments", "POST", {
          employeeId: eid,
          date: past(),
          kind: "leave_pay",
          amount: 10000,
          revision: d.revision,
          reason: "Invalid paid leave",
        })
      ).status,
    ).toBe(400);
  });
  it("keeps salary editors and attendance admins separate from payroll approvers", async () => {
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=?")
      .bind(employeeUser)
      .run();
    await env.DB.prepare(
      "INSERT INTO admin_permissions(user_id,permission) VALUES(?,'attendance.manage')",
    )
      .bind(employeeUser)
      .run();
    expect(
      (await req("/payroll/preview", "GET", undefined, employee)).status,
    ).toBe(403);
    await env.DB.prepare(
      "INSERT INTO admin_permissions(user_id,permission) VALUES(?,'salary.manage')",
    )
      .bind(employeeUser)
      .run();
    const d = await preview(past(), employee);
    expect(
      (
        await req(
          "/payroll/finalize",
          "POST",
          {
            periodDate: past(),
            revision: d.revision,
            reason: "Unauthorized salary editor",
          },
          employee,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/payroll/reopen",
          "POST",
          {
            periodDate: past(),
            revision: d.revision,
            reason: "Unauthorized reopening",
          },
          employee,
        )
      ).status,
    ).toBe(403);
  });
  it("finalizes an immutable snapshot, locks the month, exports CSV and isolates employee history", async () => {
    await ready();
    expect((await finalize()).status).toBe(200);
    const d = await preview();
    expect(d.status).toBe("finalized");
    expect(d.snapshotVersion).toBe(1);
    const csv = await req("/payroll/export?periodDate=" + past());
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("108000");
    const h = (await (
      await req("/payroll/history", "GET", undefined, employee)
    ).json()) as any;
    expect(h.snapshots[0].entry.employeeId).toBe(eid);
    expect(JSON.stringify(h)).not.toContain(oid);
    expect((await req("/payroll/export", "GET", undefined, other)).status).toBe(
      403,
    );
    await expect(
      env.DB.prepare("UPDATE payroll_snapshots SET reason='changed'").run(),
    ).rejects.toThrow("immutable");
  });
  it("blocks attendance, overtime, fine and adjustment writes after locking", async () => {
    const s = await ready();
    expect((await finalize()).status).toBe(200);
    const d = await preview();
    await expect(
      env.DB.prepare(
        "UPDATE attendance_sessions SET check_out=check_out-60 WHERE id=?",
      )
        .bind(s.session)
        .run(),
    ).rejects.toThrow("locked attendance");
    expect(
      (
        await req("/attendance/overtime", "POST", {
          employeeId: eid,
          date: past(),
          start: dayStart(past()) + 17 * 3600,
          end: dayStart(past()) + 18 * 3600,
          reason: "Forbidden locked overtime",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req("/payroll/adjustments", "POST", {
          employeeId: eid,
          date: past(),
          kind: "bonus",
          amount: 10000,
          revision: d.revision,
          reason: "Forbidden locked adjustment",
        })
      ).status,
    ).toBe(409);
  });
  it("audited reopening preserves the prior snapshot and refinalization makes version two", async () => {
    await ready();
    await finalize();
    let d = await preview();
    expect(
      (
        await req("/payroll/reopen", "POST", {
          periodDate: past(),
          revision: d.revision,
          reason: "Correct the missing bonus",
        })
      ).status,
    ).toBe(200);
    const a = await propose();
    await adjust(a);
    expect((await finalize()).status).toBe(200);
    d = await preview();
    expect(d.snapshotVersion).toBe(2);
    expect(d.entries.find((e: any) => e.employeeId === eid).finalPay).toBe(
      118000,
    );
    const h = (await (
      await req("/payroll/history", "GET", undefined, employee)
    ).json()) as any;
    expect(h.snapshots.map((s: any) => s.entry.finalPay)).toEqual([
      118000, 108000,
    ]);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='payroll.reopen'",
      ).first<any>())!.n,
    ).toBe(1);
  });
  it("deduplicates finalization and concurrent distinct-key approvals", async () => {
    await ready();
    const d = await preview(),
      payload = {
        periodDate: past(),
        revision: d.revision,
        reason: "Final payroll verified",
      },
      key = crypto.randomUUID();
    const responses = await Promise.all([
      req("/payroll/finalize", "POST", payload, root, key),
      req("/payroll/finalize", "POST", payload, root, crypto.randomUUID()),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const successIndex = responses.findIndex((r) => r.status === 200);
    if (successIndex === 0)
      expect(
        (await req("/payroll/finalize", "POST", payload, root, key)).status,
      ).toBe(200);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM payroll_snapshots",
      ).first<any>())!.n,
    ).toBe(1);
  });
  it("detects stale approval inputs and never finalizes the active month", async () => {
    await ready();
    const d = await preview();
    await propose();
    expect(
      (
        await req("/payroll/finalize", "POST", {
          periodDate: past(),
          revision: d.revision,
          reason: "Stale payroll approval",
        })
      ).status,
    ).toBe(409);
    const current = await preview(today());
    expect(
      (
        await req("/payroll/finalize", "POST", {
          periodDate: today(),
          revision: current.revision,
          reason: "Premature current month",
        })
      ).status,
    ).toBe(400);
  });
  it("requires an explicit resolution of unapproved overtime without creating paid time", async () => {
    await ready();
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_out=check_out+3600",
    ).run();
    const d = await preview();
    expect(d.warnings.some((w: any) => w.kind === "unapproved_overtime")).toBe(
      true,
    );
    expect(
      (
        await req("/payroll/resolutions", "POST", {
          periodDate: past(),
          employeeId: eid,
          date: past(),
          kind: "unapproved_overtime",
          revision: d.revision,
          reason: "Extra time was not authorized",
        })
      ).status,
    ).toBe(200);
    const p = await preview();
    expect(p.warnings.some((w: any) => w.kind === "unapproved_overtime")).toBe(
      false,
    );
    expect(p.entries.find((e: any) => e.employeeId === eid).overtimePay).toBe(
      0,
    );
  });
  it("requires explicit fine approval and invalidates approvals after progression changes", async () => {
    await ready();
    let d = await review();
    await req("/discipline/quality", "POST", {
      employeeId: eid,
      date: past(),
      revision: d.revision,
      rating: "bad",
      comment: "Bad work evidence",
      reason: "Reviewed changed quality",
    });
    d = await review();
    await req("/discipline/uniform/decision", "POST", {
      employeeId: eid,
      date: past(),
      revision: d.revision,
      status: "rejected",
      reason: "Uniform rejected on evidence",
    });
    await env.DB.prepare(
      "INSERT INTO disciplinary_policies(effective_date,policy_json,created_by,created_at,reason) VALUES(?,?,?,?,?)",
    )
      .bind(
        past().slice(0, 8) + "01",
        JSON.stringify({
          secondFine: 20000,
          thirdFine: 40000,
          fourthFine: 0,
          laterFine: 10000,
          laterAction: "Further review",
        }),
        rootId,
        Math.floor(Date.now() / 1000),
        "Historical test policy",
      )
      .run();
    let p = await preview(),
      v = p.entries
        .find((e: any) => e.employeeId === eid)
        .violations.find((v: any) => v.ordinal === 2);
    expect(p.warnings.some((w: any) => w.kind === "fine_approval")).toBe(true);
    expect(
      (
        await req("/payroll/fines/decision", "POST", {
          id: v.id,
          periodDate: past(),
          revision: p.revision,
          status: "approved",
          amount: 20000,
          reason: "Fine approved after review",
        })
      ).status,
    ).toBe(200);
    p = await preview();
    expect(p.entries.find((e: any) => e.employeeId === eid).fines).toBe(20000);
    d = await review();
    await req("/discipline/violation/decision", "POST", {
      id: d.violations[0].id,
      revision: d.revision,
      status: "reversed",
      reason: "Evidence reverses first violation",
    });
    p = await preview();
    expect(p.entries.find((e: any) => e.employeeId === eid).fines).toBe(0);
  });
  it("prevents changing payroll boundaries after finalization and validates CSV state", async () => {
    expect((await req("/payroll/export?periodDate=" + past())).status).toBe(
      409,
    );
    await ready();
    await finalize();
    const d = await preview();
    expect(
      (
        await req("/payroll/settings", "POST", {
          firstDay: 15,
          revision: d.revision,
          reason: "Change historical boundaries",
        })
      ).status,
    ).toBe(400);
  });
});

describe("Monthly salary figures without payments", () => {
  it("clears extra-time review after approval when the remaining minute cannot add a paid hour", async () => {
    const fixture = await recorded(past(), 19 * 3600 + 13 * 60, 9 * 3600);
    expect(
      (
        await req("/attendance/overtime", "POST", {
          employeeId: eid,
          date: past(),
          start: dayStart(past()) + 17 * 3600,
          end: dayStart(past()) + 19 * 3600 + 12 * 60,
          reason: "",
        })
      ).status,
    ).toBe(201);
    const p = await preview();
    const entry = p.entries.find((e: any) => e.employeeId === eid);
    expect(
      entry.days.find((d: any) => d.date === past()).pendingOvertimeSeconds,
    ).toBe(60);
    expect(entry.paidSeconds).toBe(7200);
    expect(entry.workedGross).toBe(24000);
    expect(p.warnings.some((w: any) => w.kind === "unapproved_overtime")).toBe(
      false,
    );
    // A larger remainder that completes another hour must still require review.
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_out=? WHERE id=?",
    )
      .bind(dayStart(past()) + 20 * 3600, fixture.session)
      .run();
    expect(
      (await preview()).warnings.some(
        (w: any) => w.kind === "unapproved_overtime",
      ),
    ).toBe(true);
  });
  it("returns identical whole-hour pay to admins and employees while retaining exact attendance", async () => {
    await recorded(past(), 10 * 3600 + 13 * 60);
    const admin = await preview();
    expect(admin.calculationVersion).toBe(5);
    const entry = admin.entries.find((e: any) => e.employeeId === eid);
    expect(entry.actualSeconds).toBe(2 * 3600 + 13 * 60);
    expect(entry.paidSeconds).toBe(2 * 3600);
    expect(entry.discardedSeconds).toBe(13 * 60);
    expect(entry.workedGross).toBe(24000);
    const mine = await req(
      "/payroll/mine?periodDate=" + past(),
      "GET",
      undefined,
      employee,
    );
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as any).entry.workedGross).toBe(24000);
    const attendance = await req(
      "/attendance/mine?periodDate=" + past(),
      "GET",
      undefined,
      employee,
    );
    expect(attendance.status).toBe(200);
    const summary = ((await attendance.json()) as any).summary;
    expect(summary.paidSeconds).toBe(7200);
    expect(summary.estimatedGross).toBe(24000);
  });
  it("keeps adjacent months separate and returns only the employee's figures", async () => {
    await recorded(past());
    await recorded(today());
    const previous = await req(
      "/payroll/mine?periodDate=" + past(),
      "GET",
      undefined,
      employee,
    );
    const current = await req(
      "/payroll/mine?periodDate=" + today(),
      "GET",
      undefined,
      employee,
    );
    expect(previous.status).toBe(200);
    expect(current.status).toBe(200);
    const a = (await previous.json()) as any,
      b = (await current.json()) as any;
    expect(a.period.from.slice(8)).toBe("01");
    expect(b.period.from.slice(8)).toBe("01");
    expect(a.period.to < b.period.from).toBe(true);
    expect(a.entry.employeeId).toBe(eid);
    expect(b.entry.employeeId).toBe(eid);
    expect(
      a.entry.days
        .filter((d: any) => d.actualSeconds > 0)
        .map((d: any) => d.date),
    ).toEqual([past()]);
    expect(
      b.entry.days
        .filter((d: any) => d.actualSeconds > 0)
        .map((d: any) => d.date),
    ).toEqual([today()]);
    expect(a.entries).toBeUndefined();
    expect(a.totalPay).toBeUndefined();
  });
  it("audits historical schedule corrections, recalculates figures and respects locks", async () => {
    const fixture = await recorded();
    const before = await preview();
    const input = {
      startMinute: 540,
      endMinute: 1020,
      cancelled: false,
      approved: false,
      reason: "",
      revision: before.revision,
    };
    const path = `/schedules/shifts/${fixture.shift}/edit`;
    expect((await req(path, "POST", input)).status).toBe(200);
    const after = await preview();
    const entry = (p: any) => p.entries.find((e: any) => e.employeeId === eid);
    expect(entry(before).regularSeconds).toBe(9 * 3600);
    expect(entry(after).regularSeconds).toBe(8 * 3600);
    expect(entry(before).workedGross - entry(after).workedGross).toBe(12000);
    const original = await env.DB.prepare(
      "SELECT check_in,check_out FROM attendance_sessions WHERE id=?",
    )
      .bind(fixture.session)
      .first<any>();
    expect(original.check_in).toBe(dayStart(past()) + 8 * 3600);
    expect(original.check_out).toBe(dayStart(past()) + 17 * 3600);
    const history = await env.DB.prepare(
      "SELECT * FROM schedule_corrections WHERE shift_id=?",
    )
      .bind(fixture.shift)
      .first<any>();
    expect(JSON.parse(history.before_json).start_at).toBe(
      dayStart(past()) + 8 * 3600,
    );
    expect(JSON.parse(history.after_json).start_at).toBe(
      dayStart(past()) + 9 * 3600,
    );
    await expect(
      env.DB.prepare("DELETE FROM schedule_corrections WHERE id=?")
        .bind(history.id)
        .run(),
    ).rejects.toThrow("ATBOT_CONFLICT");
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES('local-correction-lock',?,?,?,?)",
    )
      .bind(
        after.period.from,
        after.period.to,
        rootId,
        Math.floor(Date.now() / 1000),
      )
      .run();
    expect(
      (
        await req(path, "POST", {
          ...input,
          startMinute: 600,
          revision: after.revision,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM schedule_corrections",
        ).first<any>()
      ).n,
    ).toBe(1);
  });
  it("rejects new advances and non-calendar salary periods", async () => {
    const d = await preview();
    expect(
      (
        await req("/payroll/adjustments", "POST", {
          employeeId: eid,
          date: past(),
          kind: "advance",
          amount: 1000,
          reason: "",
          revision: d.revision,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/payroll/settings", "POST", {
          firstDay: 15,
          reason: "",
          revision: d.revision,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM payroll_adjustments",
        ).first<any>()
      ).n,
    ).toBe(0);
  });
});


describe("Checkout status in payroll", () => {
  it("keeps an active shift out of checkout issues until the review grace period", async () => {
    const { shift, session } = await recorded(today(), 0);
    const end = dayStart(today()) + 17 * 3600;
    const clock = vi.spyOn(Date, "now").mockReturnValue((end - 3600) * 1000);
    let d = await preview(today());
    expect(d.warnings.filter((w: any) => w.kind === "open_attendance")).toHaveLength(0);
    expect(d.entries.find((e: any) => e.employeeId === eid).days.find((day: any) => day.date === today()).openSessions).toBe(1);
    const live = await (await req("/attendance/live")).json() as any;
    expect(live.employees.find((e: any) => e.id === eid)).toMatchObject({ forgotten: false, checkout: { state: "working" } });
    clock.mockReturnValue((end + 1800) * 1000);
    d = await preview(today());
    expect(d.warnings.filter((w: any) => w.kind === "open_attendance")).toHaveLength(0);
    clock.mockReturnValue((end + 3600) * 1000);
    d = await preview(today());
    expect(d.warnings.filter((w: any) => w.kind === "open_attendance")).toHaveLength(1);
    const overdue = await (await req("/attendance/live")).json() as any;
    expect(overdue.employees.find((e: any) => e.id === eid).forgotten).toBe(true);
    await env.DB.prepare("UPDATE attendance_sessions SET check_out=? WHERE id=?").bind(end + 3600, session).run();
    expect((await preview(today())).warnings.filter((w: any) => w.kind === "open_attendance")).toHaveLength(0);
  });
  it("blocks finalization for an open historical session even before its review deadline", async () => {
    const { shift, session } = await ready();
    await env.DB.prepare("UPDATE attendance_sessions SET check_in=?,check_out=NULL WHERE id=?").bind(Math.floor(Date.now() / 1000), session).run();
    expect((await preview()).warnings.filter((w: any) => w.kind === "open_attendance")).toHaveLength(0);
    const response = await finalize();
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("Close all attendance sessions");
  });
});
