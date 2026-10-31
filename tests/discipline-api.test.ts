import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import app from "../backend/index";
import type { Bindings } from "../backend/types";
import { signedLogin, testBotToken } from "./helpers";
import { localDate } from "../shared/domain";
import { dayStart } from "../shared/attendance";
import { prepareReminders } from "../backend/notifications";
let mf: Miniflare,
  env: Bindings,
  root: string,
  employee: string,
  other: string,
  employeeId: string,
  otherId: string,
  rootId: string;
const today = () => localDate(),
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
async function data(workDate = today(), cookie = root) {
  const r = await req(
    `/discipline/${cookie === root ? "review" : "mine"}?periodDate=${workDate}`,
    "GET",
    undefined,
    cookie,
  );
  expect(r.status, await r.clone().text()).toBe(200);
  return (await r.json()) as any;
}
async function worked(
  workDate = today(),
  lateSeconds = 60,
  extra = false,
  open = false,
  id = employeeId,
) {
  const shift = crypto.randomUUID(),
    session = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,overtime_approved,created_at) VALUES(?,?,?,?,?,?,'scheduled',?,?)",
  )
    .bind(
      shift,
      id,
      workDate,
      dayStart(workDate) + 8 * 3600,
      dayStart(workDate) + 17 * 3600,
      extra ? "extra" : "regular",
      Number(extra),
      Math.floor(Date.now() / 1000),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES(?,?,?,?,?,?,'tablet',?)",
  )
    .bind(
      session,
      id,
      workDate,
      shift,
      dayStart(workDate) + 8 * 3600 + lateSeconds,
      open ? null : dayStart(workDate) + 16 * 3600,
      Math.floor(Date.now() / 1000),
    )
    .run();
  return { shift, session };
}
async function quality(rating = "good", workDate = today(), id = employeeId) {
  const d = await data(workDate);
  return req("/discipline/quality", "POST", {
    employeeId: id,
    date: workDate,
    revision: d.revision,
    rating,
    comment: rating === "bad" ? "Poor work documented" : "",
    reason: "Daily review confirmed",
  });
}
async function uniform(
  status = "rejected",
  workDate = today(),
  id = employeeId,
) {
  const d = await data(workDate);
  return req("/discipline/uniform/decision", "POST", {
    employeeId: id,
    date: workDate,
    revision: d.revision,
    status,
    reason: "Uniform evidence reviewed",
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
    TELEGRAM_WEBHOOK_SECRET: "test-webhook",
    NOTIFICATIONS_ENABLED: "false",
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
    if (id === 200001) employeeId = e.id;
    else otherId = e.id;
  }
  await db.prepare("UPDATE employees SET activation_date='2026-01-01'").run();
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
});
describe("Phase 4 on isolated D1", () => {
  async function splitDay() {
    const date = yesterday();
    await env.DB.prepare("INSERT INTO shift_overrides(id,employee_id,work_date,start_minute,end_minute,second_start_minute,second_end_minute,reason,created_by,created_at) VALUES('split-override',?,?,480,600,840,1080,'Fixture',?,?)")
      .bind(employeeId, date, rootId, Math.floor(Date.now() / 1000)).run();
    await data(date);
    const shifts = (await env.DB.prepare("SELECT * FROM scheduled_shifts WHERE employee_id=? AND work_date=? ORDER BY start_at").bind(employeeId, date).all<any>()).results;
    return { date, shifts, start: dayStart(date) };
  }
  it("reviews afternoon early departure when one physical visit spans both regular shifts", async () => {
    const { date, shifts, start } = await splitDay();
    await env.DB.prepare("INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES('spanning',?,?,?,?,?,'tablet',?)")
      .bind(employeeId, date, shifts[0].id, start + 8 * 3600, start + 17 * 3600, start).run();
    let d = await data(date);
    expect(d.early).toHaveLength(1);
    expect(d.early[0]).toMatchObject({ shiftId: shifts[1].id, missedSeconds: 3600 });
    expect(d.days[0].regularSeconds).toBe(5 * 3600);
    expect(d.tasks.some((t: any) => t.kind === "early_departure" && t.subjectId === shifts[1].id)).toBe(true);
    expect((await req("/discipline/early/decision", "POST", { shiftId: shifts[1].id, date, revision: d.revision, status: "approved", reason: "" })).status).toBe(200);
    d = await data(date);
    expect(d.tasks.some((t: any) => t.kind === "early_departure")).toBe(false);
  });
  it("agrees on a late afternoon return across live attendance, discipline and monthly tasks", async () => {
    const { date, shifts, start } = await splitDay();
    for (const [id, shift, arrival, departure] of [["morning", shifts[0].id, 8 * 3600, 10 * 3600], ["afternoon", shifts[1].id, 14 * 3600 + 12 * 60, 18 * 3600]] as const)
      await env.DB.prepare("INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES(?,?,?,?,?,?,'tablet',?)")
        .bind(id, employeeId, date, shift, start + arrival, start + departure, start).run();
    const d = await data(date);
    expect(d.violations.find((v: any) => v.id === `late:${shifts[1].id}`).reason).toBe("12 minute(s) late");
    expect(d.days[0].shiftAttendance.map((s: any) => s.lateMinutes)).toEqual([0, 12]);
    expect(d.days[0].regularSeconds).toBe(6 * 3600);
    const live: any = await (await req(`/attendance/live?date=${date}`)).json();
    expect(live.employees.find((e: any) => e.id === employeeId).lateMinutes).toBe(12);
    const payroll: any = await (await req(`/payroll/preview?periodDate=${date}`)).json();
    for (const task of d.tasks) expect(payroll.warnings.some((w: any) => w.id === task.id)).toBe(true);
  });
  it("requires explicit Good confirmation and leaves missing uniform pending without violations", async () => {
    await worked(today(), 0);
    let d = await data();
    expect(d.summary.mandatoryPending).toBe(2);
    expect(d.violations).toHaveLength(0);
    expect((await quality()).status).toBe(200);
    d = await data();
    expect(d.summary.mandatoryPending).toBe(1);
    expect(d.days[0].quality.rating).toBe("good");
  });
  it("requires check-in before uniform declaration and declares once across multiple sessions", async () => {
    let d = await data(today(), employee);
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: d.revision },
          employee,
        )
      ).status,
    ).toBe(400);
    const { shift } = await worked(today(), 0);
    d = await data(today(), employee);
    const key = crypto.randomUUID(),
      payload = { revision: d.revision };
    expect(
      (await req("/discipline/uniform", "POST", payload, employee, key)).status,
    ).toBe(200);
    expect(
      (await req("/discipline/uniform", "POST", payload, employee, key)).status,
    ).toBe(200);
    d = await data(today(), employee);
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: d.revision },
          employee,
        )
      ).status,
    ).toBe(409);
    expect((await uniform("approved")).status).toBe(200);
    await env.DB.prepare(
      "INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES('second',?,?,?,?,?,'tablet',?)",
    )
      .bind(
        employeeId,
        today(),
        shift,
        dayStart(today()) + 16 * 3600,
        dayStart(today()) + 17 * 3600,
        Math.floor(Date.now() / 1000),
      )
      .run();
    d = await data();
    expect(d.days[0].uniform.status).toBe("approved");
    expect(d.violations).toHaveLength(0);
  });
  it("rejects missing uniform explicitly, generates one violation and queues notification", async () => {
    await worked(today(), 0);
    expect((await uniform()).status).toBe(200);
    const d = await data();
    expect(d.violations.map((v: any) => v.category)).toEqual(["uniform"]);
    expect(d.violations[0].proposedFine).toBe(0);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM notification_outbox WHERE event_key LIKE 'uniform-rejected:%'",
      ).first<any>())!.n,
    ).toBe(1);
    expect((await uniform("approved")).status).toBe(400);
  });
  it("a later declaration preserves rejection and an audited reversal removes the violation", async () => {
    await worked(today(), 0);
    await uniform();
    let d = await data(today(), employee);
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: d.revision },
          employee,
        )
      ).status,
    ).toBe(200);
    d = await data();
    expect(d.days[0].uniform.status).toBe("rejected");
    expect((await uniform("approved")).status).toBe(200);
    expect((await data()).violations).toHaveLength(0);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='uniform.review'",
      ).first<any>())!.n,
    ).toBe(2);
  });
  it("Bad is a distinct daily violation while Excellent and Good are not", async () => {
    await worked(today(), 60);
    expect((await quality("bad")).status).toBe(200);
    await uniform();
    let d = await data();
    expect(d.violations).toHaveLength(3);
    expect(d.violations.map((v: any) => v.ordinal)).toEqual([1, 2, 3]);
    expect((await quality("excellent")).status).toBe(200);
    d = await data();
    expect(d.violations).toHaveLength(2);
  });
  it("records no-uniform as a pending declaration and requires an administrator decision", async () => {
    await worked(today(), 0);
    let d = await data();
    const declaration = await req(
      "/discipline/uniform",
      "POST",
      { revision: d.revision, hasUniform: false },
      employee,
    );
    expect(declaration.status, await declaration.clone().text()).toBe(200);
    d = await data();
    expect(d.days[0].uniform.declared_has_uniform).toBe(0);
    expect(d.days[0].uniform.declared_at).toBeGreaterThan(0);
    expect(d.days[0].uniform.status).toBe("pending");
    expect(d.violations).toHaveLength(0);
    expect((await uniform("approved")).status).toBe(400);
    const rejected = await req("/discipline/uniform/decision", "POST", {
      employeeId,
      date: today(),
      revision: d.revision,
      status: "rejected",
    });
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    d = await data();
    expect(d.days[0].uniform.declared_has_uniform).toBe(0);
    expect(d.days[0].uniform.status).toBe("rejected");
    expect(d.violations).toHaveLength(1);
    const duplicate = await req(
      "/discipline/uniform",
      "POST",
      { revision: d.revision, hasUniform: true },
      employee,
    );
    expect(duplicate.status).toBe(409);
    expect((await data()).days[0].uniform.status).toBe("rejected");
  });
  it("accepts blank, omitted and short review notes while keeping review identity and history", async () => {
    await worked(today(), 0);
    let d = await data();
    const bad = await req("/discipline/quality", "POST", {
      employeeId,
      date: today(),
      revision: d.revision,
      rating: "bad",
    });
    expect(bad.status, await bad.clone().text()).toBe(200);
    for (const note of [undefined, "", "ok"]) {
      d = await data();
      const response = await req("/discipline/uniform/decision", "POST", {
        employeeId,
        date: today(),
        revision: d.revision,
        status: "rejected",
        reason: note,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const row = await env.DB.prepare(
        "SELECT * FROM daily_uniform_confirmations WHERE employee_id=? AND work_date=?",
      )
        .bind(employeeId, today())
        .first<any>();
      expect(row.decision_reason).toBe(note ?? "");
      expect(row.reviewed_by).toBe(rootId);
      expect(row.reviewed_at).toBeGreaterThan(0);
    }
    expect((await data()).violations).toHaveLength(2);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='uniform.review'",
      ).first<any>())!.n,
    ).toBe(3);
    expect(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
  });
  it("enforces the 60-second threshold, first arrival only, and excludes approved extra shifts", async () => {
    const s = await worked(today(), 59);
    expect((await data()).violations).toHaveLength(0);
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_in=check_in+1 WHERE id=?",
    )
      .bind(s.session)
      .run();
    expect((await data()).violations).toHaveLength(1);
    await env.DB.prepare(
      "INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES('return',?,?,?,?,?,'tablet',?)",
    )
      .bind(
        employeeId,
        today(),
        s.shift,
        dayStart(today()) + 16 * 3600,
        dayStart(today()) + 17 * 3600,
        Math.floor(Date.now() / 1000),
      )
      .run();
    await worked(today(), 3600, true, false, otherId);
    expect((await data()).violations).toHaveLength(1);
  });
  it("excuses lateness without changing attendance pay, supports retry and records the reason", async () => {
    const s = await worked(today(), 35 * 60),
      before = await env.DB.prepare(
        "SELECT * FROM attendance_sessions WHERE id=?",
      )
        .bind(s.session)
        .first();
    const d = await data(),
      key = crypto.randomUUID(),
      payload = {
        id: d.violations[0].id,
        revision: d.revision,
        status: "excused",
        reason: "Approved exceptional delay",
      };
    expect(
      (await req("/discipline/violation/decision", "POST", payload, root, key))
        .status,
    ).toBe(200);
    expect(
      (await req("/discipline/violation/decision", "POST", payload, root, key))
        .status,
    ).toBe(200);
    expect((await data()).summary.countedViolations).toBe(0);
    expect(
      await env.DB.prepare("SELECT * FROM attendance_sessions WHERE id=?")
        .bind(s.session)
        .first(),
    ).toEqual(before);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='violation.decision'",
      ).first<any>())!.n,
    ).toBe(1);
  });
  it("concurrent distinct-key reviews cannot both commit from the same snapshot", async () => {
    await worked(today(), 0);
    const d = await data();
    const payload = {
      employeeId,
      date: today(),
      revision: d.revision,
      rating: "good",
      comment: "",
      reason: "Explicit daily review",
    };
    const results = await Promise.all([
      req("/discipline/quality", "POST", payload),
      req("/discipline/quality", "POST", {
        ...payload,
        rating: "bad",
        comment: "Bad work evidence",
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM audit_logs WHERE action='quality.review'",
      ).first<any>())!.n,
    ).toBe(1);
  });
  it("attendance corrections invalidate work reviews and stale excuses", async () => {
    const s = await worked(today(), 60);
    await quality();
    let d = await data();
    await req("/discipline/violation/decision", "POST", {
      id: d.violations[0].id,
      revision: d.revision,
      status: "excused",
      reason: "Delay initially excused",
    });
    d = await data();
    const oldRevision = d.revision;
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_in=check_in+60 WHERE id=?",
    )
      .bind(s.session)
      .run();
    d = await data();
    expect(d.days[0].qualityPending).toBe(true);
    expect(d.violations[0].status).toBe("detected");
    expect(
      (
        await req("/discipline/quality", "POST", {
          employeeId,
          date: today(),
          revision: oldRevision,
          rating: "good",
          comment: "",
          reason: "Stale review attempt",
        })
      ).status,
    ).toBe(409);
  });
  it("preserves employee isolation and server-side review and policy permissions", async () => {
    await worked(today(), 60);
    expect((await data(today(), other)).violations).toHaveLength(0);
    expect(
      (await req("/discipline/review", "GET", undefined, employee)).status,
    ).toBe(403);
    const d = await data();
    expect(
      (
        await req(
          "/discipline/quality",
          "POST",
          {
            employeeId: otherId,
            date: today(),
            revision: d.revision,
            rating: "good",
            comment: "",
            reason: "Unauthorized review",
          },
          employee,
        )
      ).status,
    ).toBe(403);
    expect((await req("/discipline/policy", "POST", {}, employee)).status).toBe(
      403,
    );
    const user = (await env.DB.prepare(
      "SELECT user_id FROM employees WHERE id=?",
    )
      .bind(otherId)
      .first<any>())!.user_id;
    await env.DB.prepare("UPDATE users SET access='admin' WHERE id=?")
      .bind(user)
      .run();
    expect(
      (await req("/discipline/review", "GET", undefined, other)).status,
    ).toBe(403);
  });
  it("locked periods reject review, uniform and disciplinary changes", async () => {
    await worked(today(), 60);
    const d = await data();
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES('lock',?,?,?,?)",
    )
      .bind(d.period.from, d.period.to, rootId, Math.floor(Date.now() / 1000))
      .run();
    expect((await quality()).status).toBe(409);
    expect((await uniform()).status).toBe(409);
    expect(
      (
        await req("/discipline/violation/decision", "POST", {
          id: d.violations[0].id,
          revision: d.revision,
          status: "reversed",
          reason: "Forbidden locked change",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: d.revision },
          employee,
        )
      ).status,
    ).toBe(409);
  });
  it("early departures have explicit decisions and no automatic fine", async () => {
    const s = await worked(today(), 0),
      d = await data();
    expect(d.early[0].missedSeconds).toBe(3600);
    expect(d.violations).toHaveLength(0);
    expect(
      (
        await req("/discipline/early/decision", "POST", {
          shiftId: s.shift,
          date: today(),
          revision: d.revision,
          status: "approved",
          reason: "Approved family appointment",
        })
      ).status,
    ).toBe(200);
    expect((await data()).early[0].review.status).toBe("approved");
    await env.DB.prepare(
      "UPDATE attendance_sessions SET check_out=check_out+60 WHERE id=?",
    )
      .bind(s.session)
      .run();
    expect((await data()).early[0].review).toBeNull();
  });
  it("configured proposals recalculate after reversal and manager completion is audited", async () => {
    await worked(today(), 60);
    await quality("bad");
    await uniform();
    await worked(yesterday(), 60);
    let d = await data();
    expect(
      (
        await req("/discipline/policy", "POST", {
          revision: d.revision,
          effectiveDate: d.period.from,
          secondFine: 20000,
          thirdFine: 40000,
          fourthFine: 0,
          laterFine: null,
          laterAction: "Manager follow-up required",
          reason: "Owner configured amounts",
        })
      ).status,
    ).toBe(200);
    d = await data();
    expect(d.summary.proposedFineTotal).toBe(60000);
    const v = d.violations.find((v: any) => v.ordinal === 4);
    expect(
      (
        await req("/discipline/meeting", "POST", {
          id: v.id,
          date: v.work_date,
          revision: d.revision,
          reason: "Meeting held and documented",
        })
      ).status,
    ).toBe(200);
    d = await data();
    expect(d.summary.meetingPending).toBe(0);
    expect(
      (
        await req("/discipline/violation/decision", "POST", {
          id: d.violations[0].id,
          revision: d.revision,
          status: "reversed",
          reason: "Evidence clears the violation",
        })
      ).status,
    ).toBe(200);
    d = await data();
    expect(d.violations.map((v: any) => v.ordinal)).toEqual([0, 1, 2, 3]);
    expect(d.summary.meetingPending).toBe(0);
    expect(d.fineApprovalAvailable).toBe(false);
  });
  it("keeps earlier months on their historical policy and resets monthly counts", async () => {
    const past = localDate(Date.now() - 40 * 86400000);
    await worked(past, 60);
    await worked(today(), 60);
    let d = await data();
    expect(
      (
        await req("/discipline/policy", "POST", {
          revision: d.revision,
          effectiveDate: d.period.from,
          secondFine: 20000,
          thirdFine: 40000,
          fourthFine: 0,
          laterFine: 10000,
          laterAction: "Further review required",
          reason: "Current month policy",
        })
      ).status,
    ).toBe(200);
    const old = await data(past);
    expect(old.policy.secondFine).toBeNull();
    expect(old.violations[0].ordinal).toBe(1);
    expect((await data()).violations[0].ordinal).toBe(1);
  });
  it("queues only one daily admin reminder for outstanding historical reviews", async () => {
    await worked(yesterday(), 0);
    await prepareReminders(env);
    await prepareReminders(env);
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM notification_outbox WHERE event_key LIKE 'daily-review:%'",
      ).first<any>())!.n,
    ).toBe(1);
  });
});

describe("Administrator supplies a missing uniform choice", () => {
  it.each([[true, "approved", 0], [false, "rejected", 1]] as const)("records %s and finishes the review directly", async (hasUniform, status, violations) => {
    await worked(today(), 0);
    const d = await data();
    const input = { employeeId, date: today(), revision: d.revision, status, hasUniform };
    const key = crypto.randomUUID();
    const response = await req("/discipline/uniform/decision", "POST", input, root, key);
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await req("/discipline/uniform/decision", "POST", input, root, key)).status).toBe(200);
    const after = await data();
    expect(after.days[0].uniform).toMatchObject({ status, admin_has_uniform: Number(hasUniform), declared_at: null, reviewed_by: rootId });
    expect(after.violations).toHaveLength(violations);
    expect((await req("/discipline/uniform/decision", "POST", { ...input, revision: after.revision }, employee)).status).toBe(403);
    // A later employee declaration keeps the administrator's completed review.
    expect((await req("/discipline/uniform", "POST", { revision: after.revision, hasUniform: !hasUniform }, employee)).status).toBe(200);
    expect((await data()).days[0].uniform.status).toBe(status);
  });
  it("rejects mismatched choices and protects an existing employee declaration", async () => {
    await worked(today(), 0);
    let d = await data();
    expect((await req("/discipline/uniform/decision", "POST", { employeeId, date: today(), revision: d.revision, status: "approved", hasUniform: false })).status).toBe(400);
    expect((await req("/discipline/uniform", "POST", { revision: d.revision, hasUniform: false }, employee)).status).toBe(200);
    d = await data();
    expect((await req("/discipline/uniform/decision", "POST", { employeeId, date: today(), revision: d.revision, status: "approved", hasUniform: true })).status).toBe(400);
  });
});

describe("Confirming whole workdays", () => {
  const yesterday = () => localDate(Date.now() - 86400000);
  it("saves quality and uniform for several days atomically and returns the next revision", async () => {
    await worked(today(), 0);
    await worked(yesterday(), 0);
    const d = await data();
    const days = [today(), yesterday()].map((date) => ({
      employeeId, date, quality: { rating: "good" }, uniform: { status: "approved", hasUniform: true },
    }));
    const response = await req("/discipline/days", "POST", { revision: d.revision, days });
    expect(response.status, await response.clone().text()).toBe(200);
    const saved = (await response.json()) as any;
    const after = await data();
    expect(saved).toMatchObject({ ok: true, saved: 2, revision: after.revision });
    for (const day of after.days.filter((x: any) => [today(), yesterday()].includes(x.work_date))) {
      expect(day.quality.rating).toBe("good");
      expect(day.uniform).toMatchObject({ status: "approved", admin_has_uniform: 1 });
    }
    // The returned revision lets the next batch go straight through.
    expect((await req("/discipline/days", "POST", { revision: saved.revision,
      days: [{ employeeId, date: today(), quality: { rating: "excellent" } }] })).status).toBe(200);
  });
  it("rolls back every day when one day is invalid, and rejects stale revisions", async () => {
    await worked(today(), 0);
    let d = await data();
    expect((await req("/discipline/days", "POST", { revision: d.revision, days: [
      { employeeId, date: today(), quality: { rating: "good" } },
      { employeeId, date: "2026-01-02", quality: { rating: "good" } },
    ] })).status).toBe(400);
    d = await data();
    expect(d.days[0].quality).toBeNull();
    expect((await req("/discipline/days", "POST", { revision: d.revision - 1,
      days: [{ employeeId, date: today(), quality: { rating: "good" } }] })).status).toBe(409);
    expect((await req("/discipline/days", "POST", { revision: d.revision,
      days: [{ employeeId, date: today() }] })).status).toBe(400);
    expect((await req("/discipline/days", "POST", { revision: d.revision,
      days: [{ employeeId, date: today(), quality: { rating: "good" } }] }, employee)).status).toBe(403);
  });
});

describe("Correcting uniform choices", () => {
  it("allows an audited correction before review and protects an administrator decision", async () => {
    await worked(today(), 0);
    let snapshot = await data();
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: snapshot.revision, hasUniform: false },
          employee,
        )
      ).status,
    ).toBe(200);
    snapshot = await data();
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          {
            revision: snapshot.revision,
            hasUniform: true,
            amend: true,
            reason: "",
          },
          employee,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT declared_has_uniform FROM daily_uniform_confirmations WHERE employee_id=?",
        )
          .bind(employeeId)
          .first<any>()
      ).declared_has_uniform,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='uniform.correct'",
        ).first<any>()
      ).n,
    ).toBe(1);
    expect((await uniform("approved")).status).toBe(200);
    snapshot = await data();
    expect(
      (
        await req(
          "/discipline/uniform",
          "POST",
          { revision: snapshot.revision, hasUniform: false, amend: true },
          employee,
        )
      ).status,
    ).toBe(409);
  });
});
