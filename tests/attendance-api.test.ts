import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import app from "../backend/index";
import type { Bindings } from "../backend/types";
import { localDate } from "../shared/domain";
import { dayStart, calculateAttendance } from "../shared/attendance";
import { automaticCheckout } from "../backend/automatic-checkout";
import { scheduledNotifications } from "../backend/notifications";
import { issueQR } from "../backend/qr";
import { signedLogin, testBotToken } from "./helpers";
let mf: Miniflare,
  env: Bindings,
  root: string,
  employeeCookie: string,
  tabletCookie: string,
  employeeId: string,
  userId: string,
  tabletId: string,
  levelId: string;
const checkoutPayloads = new Map<string, { qr: string }>();
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = root,
  key = crypto.randomUUID(),
) {
  if (
    path === "/attendance/check-out" &&
    body &&
    typeof body === "object" &&
    Object.keys(body).length === 0
  ) {
    const input = checkoutPayloads.get(key) ?? { qr: await currentQR() };
    checkoutPayloads.set(key, input);
    body = input;
  }
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
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}
async function login(id: number) {
  const res = await req(
    "/auth/telegram",
    "POST",
    { initData: signedLogin(id) },
    "",
  );
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}
const json = async <T>(res: Response) => (await res.json()) as T;
async function currentQR() {
  return (await issueQR(tabletId, testBotToken)).token;
}
beforeEach(async () => {
  checkoutPayloads.clear();
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-06",
      d1Databases: ["DB"],
    }),
  );
  const db = await mf.getD1Database("DB"),
    dir = new URL("../database/migrations/", import.meta.url),
    sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(new URL(f, dir), "utf8"))
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
    APP_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:5173",
    TELEGRAM_BOT_TOKEN: testBotToken,
    BOOTSTRAP_TELEGRAM_ID: "100001",
  };
  root = await login(100001);
  let res = await req("/roles/office-manager/levels", "POST", {
    name: "Junior",
    hourlyRate: 12000,
    effectiveDate: localDate(),
  });
  expect(res.status).toBe(201);
  levelId = (await json<{ id: string }>(res)).id;
  res = await req("/employees", "POST", {
    fullName: "Employee One",
    telegramId: "200001",
    levelId,
    activationDate: localDate(),
  });
  expect(res.status).toBe(201);
  ({ id: employeeId, userId } = await json<{ id: string; userId: string }>(
    res,
  ));
  employeeCookie = await login(200001);
  res = await req("/schedules/weekly", "POST", {
    employeeId,
    weekday: new Date(localDate() + "T00:00:00Z").getUTCDay(),
    startMinute: 0,
    endMinute: 1439,
    effectiveDate: localDate(),
    reason: "Test schedule",
  });
  expect(res.status).toBe(201);
  res = await req("/tablets", "POST", {
    name: "Reception",
    pairingCode: "a".repeat(64),
  });
  expect(res.status).toBe(201);
  tabletId = (await json<{ id: string }>(res)).id;
  res = await req("/tablet/pair", "POST", { code: "a".repeat(64) }, "");
  expect(res.status).toBe(200);
  tabletCookie = res.headers.get("set-cookie")!.split(";")[0];
});
afterEach(async () => {
  await mf?.dispose();
});
describe("Team week schedule", () => {
  it("lists every active employee's shifts for up to a week and requires attendance permission", async () => {
    const from = localDate(), to = localDate(Date.parse(from + "T12:00:00+05:00") + 6 * 86400000);
    const response = await req(`/schedules/team?from=${from}&to=${to}`);
    expect(response.status, await response.clone().text()).toBe(200);
    const week = await json<{ people: { id: string }[]; shifts: { employee_id: string; work_date: string }[] }>(response);
    expect(week.people.map((p) => p.id)).toContain(employeeId);
    expect(week.shifts.some((s) => s.employee_id === employeeId && s.work_date === from)).toBe(true);
    const tooLong = localDate(Date.parse(from + "T12:00:00+05:00") + 7 * 86400000);
    expect((await req(`/schedules/team?from=${from}&to=${tooLong}`)).status).toBe(400);
    expect((await req(`/schedules/team?from=${from}&to=${to}`, "GET", undefined, employeeCookie)).status).toBe(403);
  });
});
describe("Split regular shifts", () => {
  async function schedule() {
    const response = await req(`/schedules?employeeId=${employeeId}&from=${localDate()}&to=${localDate()}`);
    expect(response.status, await response.clone().text()).toBe(200);
    return json<any>(response);
  }
  async function split() {
    const d = await schedule();
    const response = await req(`/schedules/weekly/${d.weekly[0].id}/edit`, "POST", {
      startMinute: 480, endMinute: 600, secondStartMinute: 840, secondEndMinute: 1080,
      effectiveDate: localDate(), active: true, revision: d.revision,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return schedule();
  }
  it("materializes two recurring regular shifts, preserves their identities and pays six hours", async () => {
    const d = await split();
    expect(d.shifts.map((s: any) => [s.slot, s.start_at - dayStart(localDate()), s.end_at - dayStart(localDate())]))
      .toEqual([[1, 8 * 3600, 10 * 3600], [2, 14 * 3600, 18 * 3600]]);
    expect((await schedule()).shifts).toEqual(d.shifts);
    const morning = { check_in: d.shifts[0].start_at, check_out: d.shifts[0].end_at, shift_id: d.shifts[0].id };
    const afternoon = { check_in: d.shifts[1].start_at, check_out: d.shifts[1].end_at, shift_id: d.shifts[1].id };
    expect(calculateAttendance([morning, afternoon], d.shifts).regularSeconds).toBe(6 * 3600);
    expect(calculateAttendance([{ ...morning, check_out: afternoon.check_out }], d.shifts).regularSeconds).toBe(6 * 3600);
  });
  it("supports a dated split override and rejects overlapping or incomplete second windows", async () => {
    for (const second of [{ secondStartMinute: 599, secondEndMinute: 1080 }, { secondStartMinute: 840 }, { secondStartMinute: 840, secondEndMinute: 800 }]) {
      expect((await req("/schedules/override", "POST", { employeeId, date: localDate(), startMinute: 480, endMinute: 600, ...second })).status).toBe(400);
    }
    expect((await req("/schedules/override", "POST", { employeeId, date: localDate(), startMinute: 480, endMinute: 600, secondStartMinute: 840, secondEndMinute: 1080 })).status).toBe(200);
    expect((await schedule()).shifts.filter((s: any) => s.status === "scheduled")).toHaveLength(2);
  });
  it("edits, cancels and restores either shift independently after recorded attendance", async () => {
    let d = await split();
    const primary = d.shifts[0], secondary = d.shifts[1];
    await env.DB.prepare("INSERT INTO attendance_sessions(id,employee_id,work_date,shift_id,check_in,check_out,tablet_id,created_at) VALUES('recorded-split',?,?,?,?,?,?,?)")
      .bind(employeeId, localDate(), primary.id, primary.start_at, primary.end_at, tabletId, primary.start_at).run();
    d = await schedule();
    for (const [target, cancelled] of [[secondary, true], [secondary, false], [primary, true], [primary, false]] as const) {
      const response = await req(`/schedules/shifts/${target.id}/edit`, "POST", {
        startMinute: target.slot === 1 ? 480 : 840, endMinute: target.slot === 1 ? 600 : 1080,
        cancelled, revision: d.revision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      d = await schedule();
      expect(d.shifts.find((s: any) => s.id === target.id).status).toBe(cancelled ? "cancelled" : "scheduled");
      expect(d.shifts.find((s: any) => s.id !== target.id).status).toBe("scheduled");
    }
    expect((await req(`/schedules/shifts/${secondary.id}/edit`, "POST", { startMinute: 590, endMinute: 1080, revision: d.revision })).status).toBe(400);
    expect((await schedule()).shifts[0].start_at).toBe(primary.start_at);
  });
  it("moves both weekly windows atomically and cancels a removed second shift", async () => {
    let d = await split();
    const ids = d.shifts.map((s: any) => s.id);
    for (const second of [{ secondStartMinute: 1200, secondEndMinute: 1320 }, { secondStartMinute: null, secondEndMinute: null }]) {
      const response = await req(`/schedules/weekly/${d.weekly[0].id}/edit`, "POST", {
        startMinute: 960, endMinute: 1020, ...second, effectiveDate: localDate(), active: true, revision: d.revision,
      });
      expect(response.status, await response.clone().text()).toBe(200);
      d = await schedule();
      expect(d.shifts.map((s: any) => s.id)).toEqual(ids);
    }
    expect(d.shifts[1].status).toBe("cancelled");
  });
});

describe("Automatic daily checkout", () => {
  const cutoff = () => dayStart(localDate()) + 23 * 3600;
  async function insert(open = true) {
    await env.DB.prepare("INSERT INTO attendance_sessions(id,employee_id,work_date,check_in,check_out,tablet_id,created_at) VALUES('automatic',?,?,?,?,?,?)")
      .bind(employeeId, localDate(), dayStart(localDate()) + 8 * 3600, open ? null : dayStart(localDate()) + 17 * 3600, tabletId, 1).run();
  }
  async function row() { return env.DB.prepare("SELECT * FROM attendance_sessions WHERE id='automatic'").first<any>(); }
  it("closes exactly at 23:00 Tashkent, including a delayed run, and retries only once", async () => {
    await insert();
    await automaticCheckout(env.DB, cutoff() - 1);
    expect((await row()).check_out).toBeNull();
    await Promise.all([automaticCheckout(env.DB, cutoff()), automaticCheckout(env.DB, cutoff() + 86400)]);
    expect((await row()).check_out).toBe(cutoff());
    expect((await row()).closed_by).toBeNull();
    await automaticCheckout(env.DB, cutoff() + 2 * 86400);
    expect((await env.DB.prepare("SELECT count(*) n FROM automatic_checkouts").first<any>()).n).toBe(1);
    expect((await env.DB.prepare("SELECT closed_at FROM attendance_closures WHERE session_id='automatic'").first<any>()).closed_at).toBe(cutoff());
    const mine = await json<any>(await req("/attendance/mine", "GET", undefined, employeeCookie));
    expect(mine.days.find((d: any) => d.date === localDate()).sessions[0].automatically_closed).toBe(1);
  });
  it("leaves an employee's existing checkout unchanged", async () => {
    await insert(false);
    const before = await row();
    await automaticCheckout(env.DB, cutoff() + 60);
    expect(await row()).toEqual(before);
    expect((await env.DB.prepare("SELECT count(*) n FROM automatic_checkouts").first<any>()).n).toBe(0);
  });
  it("runs from the scheduler even with Telegram notifications disabled", async () => {
    await insert();
    const spy = vi.spyOn(Date, "now").mockReturnValue(cutoff() * 1000);
    try { await scheduledNotifications({ ...env, NOTIFICATIONS_ENABLED: "false" }); }
    finally { spy.mockRestore(); }
    expect((await row()).check_out).toBe(cutoff());
  });
  it("hourly removes expired idempotency keys and old webhook replies only", async () => {
    const at = cutoff(), user = (await env.DB.prepare("SELECT id FROM users LIMIT 1").first<any>()).id;
    await env.DB.batch([
      ...[["old-key-000000000", at - 8 * 86400], ["new-key-000000000", at - 86400]].map(([key, created]) =>
        env.DB.prepare("INSERT INTO idempotency_keys(actor_id,key,fingerprint,response_json,status,created_at) VALUES(?,?,'f','{}',200,?)").bind(user, key, created)),
      ...[["webhook:1", at - 31 * 86400], ["webhook:2", at - 86400], ["forgotten:1", at - 31 * 86400]].map(([key, created]) =>
        env.DB.prepare("INSERT INTO notification_outbox(id,event_key,user_id,text,next_attempt_at,created_at,status) VALUES(?,?,?,'x',?,?,'sent')").bind(crypto.randomUUID(), key, user, created, created)),
    ]);
    const spy = vi.spyOn(Date, "now").mockReturnValue(at * 1000);
    try { await scheduledNotifications({ ...env, NOTIFICATIONS_ENABLED: "false" }); }
    finally { spy.mockRestore(); }
    expect((await env.DB.prepare("SELECT key FROM idempotency_keys WHERE key LIKE '%-key-%'").all<any>()).results.map((r) => r.key)).toEqual(["new-key-000000000"]);
    expect((await env.DB.prepare("SELECT event_key FROM notification_outbox WHERE event_key IN ('webhook:1','webhook:2','forgotten:1') ORDER BY event_key").all<any>()).results.map((r) => r.event_key)).toEqual(["forgotten:1", "webhook:2"]);
  });
  it("keeps a concurrent employee checkout or the automatic cutoff as one atomic close", async () => {
    await insert();
    const [response] = await Promise.all([
      req("/attendance/check-out", "POST", {}, employeeCookie), automaticCheckout(env.DB, cutoff()),
    ]);
    expect([200, 409]).toContain(response.status);
    const saved = await row();
    const marker = await env.DB.prepare("SELECT closed_at FROM attendance_closures WHERE session_id='automatic'").first<any>();
    expect(marker.closed_at).toBe(saved.check_out);
    expect(saved.check_out).toBeLessThanOrEqual(cutoff());
  });
});

describe("Saved schedule editing", () => {
  const future = () => localDate(Date.now() + 86400000);
  async function schedules(from = localDate()) {
    const r = await req(
      `/schedules?employeeId=${employeeId}&from=${from}&to=${localDate(Date.parse(from + "T00:00:00+05:00") + 6 * 86400000)}`,
    );
    expect(r.status, await r.clone().text()).toBe(200);
    return (await r.json()) as any;
  }
  async function futureRegular() {
    expect(
      (
        await req("/schedules/weekly", "POST", {
          employeeId,
          weekday: new Date(future() + "T00:00:00Z").getUTCDay(),
          startMinute: 480,
          endMinute: 1020,
          effectiveDate: localDate(),
          active: true,
          reason: "Future weekly fixture",
        })
      ).status,
    ).toBe(201);
    return schedules(future());
  }
  it("edits same-date recurring hours without a duplicate and audits before/after", async () => {
    let d = await schedules();
    const w = d.weekly[0];
    expect(
      (
        await req(`/schedules/weekly/${w.id}/edit`, "POST", {
          startMinute: 480,
          endMinute: 1080,
          effectiveDate: w.effective_date,
          active: true,
          reason: "Correct recurring hours",
          revision: d.revision,
        })
      ).status,
    ).toBe(200);
    d = await schedules();
    expect(d.weekly).toHaveLength(1);
    expect(d.shifts[0].start_at).toBe(dayStart(localDate()) + 480 * 60);
    const audit = await env.DB.prepare(
      "SELECT before_json,after_json FROM audit_logs WHERE action='schedule.weekly.edit'",
    ).first<any>();
    expect(JSON.parse(audit.before_json).start_minute).toBe(0);
    expect(JSON.parse(audit.after_json).startMinute).toBe(480);
  });
  it("creates a later weekly version while preserving recorded earlier attendance", async () => {
    const d = await schedules(),
      w = d.weekly[0];
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    const fresh = await schedules();
    expect(
      (
        await req(`/schedules/weekly/${w.id}/edit`, "POST", {
          startMinute: 600,
          endMinute: 1080,
          effectiveDate: future(),
          active: true,
          reason: "Later weekly change",
          revision: fresh.revision,
        })
      ).status,
    ).toBe(200);
    const after = await schedules();
    expect(after.weekly).toHaveLength(2);
    expect(after.shifts[0].start_at).toBe(dayStart(localDate()));
  });
  it("edits, cancels and restores one regular day without changing its weekly rule", async () => {
    let d = await futureRegular();
    const shift = d.shifts[0];
    for (const cancelled of [false, true, false]) {
      expect(
        (
          await req(
            `/schedules/shifts/${encodeURIComponent(shift.id)}/edit`,
            "POST",
            {
              startMinute: 600,
              endMinute: 1080,
              cancelled,
              approved: false,
              reason: "One-day schedule change",
              revision: d.revision,
            },
          )
        ).status,
      ).toBe(200);
      d = await schedules(future());
      expect(d.shifts[0].status).toBe(cancelled ? "cancelled" : "scheduled");
      expect(d.shifts[0].start_at).toBe(dayStart(future()) + 600 * 60);
    }
    expect(
      d.weekly.find(
        (w: any) => w.weekday === new Date(future() + "T00:00:00Z").getUTCDay(),
      ).start_minute,
    ).toBe(480);
  });
  it("edits extra hours and explicit overtime approval with idempotent replay", async () => {
    const created = await req("/schedules/extra", "POST", {
      employeeId,
      date: future(),
      startMinute: 480,
      endMinute: 540,
      approved: false,
      reason: "Extra fixture",
    });
    const { id } = (await created.json()) as any;
    const d = await schedules(future()),
      input = {
        startMinute: 600,
        endMinute: 660,
        approved: true,
        cancelled: false,
        reason: "Edited extra shift",
        revision: d.revision,
      },
      key = crypto.randomUUID();
    for (let i = 0; i < 2; i++)
      expect(
        (await req(`/schedules/shifts/${id}/edit`, "POST", input, root, key))
          .status,
      ).toBe(200);
    const after = await schedules(future());
    expect(after.shifts.find((s: any) => s.id === id).overtime_approved).toBe(
      1,
    );
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='schedule.shift.edit'",
        ).first<any>()
      ).n,
    ).toBe(1);
  });
  it("rejects stale concurrent edits without duplicate audit records", async () => {
    const d = await futureRegular(),
      id = encodeURIComponent(d.shifts[0].id);
    const responses = await Promise.all(
      [600, 660].map((startMinute) =>
        req(`/schedules/shifts/${id}/edit`, "POST", {
          startMinute,
          endMinute: 1080,
          approved: false,
          cancelled: false,
          reason: "Concurrent edit",
          revision: d.revision,
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='schedule.shift.edit'",
        ).first<any>()
      ).n,
    ).toBe(1);
  });
  it("corrects recorded days but protects recurring rules and locked months", async () => {
    let d = await schedules();
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    d = await schedules();
    expect(
      (
        await req(
          `/schedules/shifts/${encodeURIComponent(d.shifts[0].id)}/edit`,
          "POST",
          {
            startMinute: 600,
            endMinute: 1080,
            cancelled: false,
            approved: false,
            reason: "Protected recorded day",
            revision: d.revision,
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM schedule_corrections",
        ).first<any>()
      ).n,
    ).toBe(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM schedule_correction_context",
        ).first<any>()
      ).n,
    ).toBe(0);
    d = await schedules();
    const w = d.weekly[0];
    expect(
      (
        await req(`/schedules/weekly/${w.id}/edit`, "POST", {
          startMinute: 600,
          endMinute: 1080,
          effectiveDate: localDate(),
          active: true,
          reason: "Protected weekly edit",
          revision: d.revision,
        })
      ).status,
    ).toBe(409);
    await env.DB.prepare(
      "INSERT INTO payroll_period_locks(id,from_date,to_date,locked_by,locked_at) VALUES('edit-lock',?,?,?,?)",
    )
      .bind(
        future(),
        future(),
        (
          await env.DB.prepare(
            "SELECT id FROM users WHERE access='super_admin'",
          ).first<any>()
        ).id,
        Math.floor(Date.now() / 1000),
      )
      .run();
    d = await schedules();
    expect(
      (
        await req(`/schedules/weekly/${w.id}/edit`, "POST", {
          startMinute: 600,
          endMinute: 1080,
          effectiveDate: future(),
          active: true,
          reason: "Locked future edit",
          revision: d.revision,
        })
      ).status,
    ).toBe(409);
  });
  it("denies employee edits and invalid ranges without modifying a schedule", async () => {
    const d = await schedules(),
      w = d.weekly[0],
      input = {
        startMinute: 480,
        endMinute: 1080,
        effectiveDate: localDate(),
        active: true,
        reason: "Permission test",
        revision: d.revision,
      };
    expect(
      (
        await req(
          `/schedules/weekly/${w.id}/edit`,
          "POST",
          input,
          employeeCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(`/schedules/weekly/${w.id}/edit`, "POST", {
          ...input,
          endMinute: 400,
        })
      ).status,
    ).toBe(400);
    expect((await schedules()).weekly[0].start_minute).toBe(0);
  });
});
describe("Phase 2 API with isolated D1", () => {
  it("replays concurrent same-key actions with one session and one close", async () => {
    const input = { qr: await currentQR() },
      key = crypto.randomUUID();
    const incoming = await Promise.all([
      req("/attendance/check-in", "POST", input, employeeCookie, key),
      req("/attendance/check-in", "POST", input, employeeCookie, key),
    ]);
    expect(incoming.map((r) => r.status)).toEqual([201, 201]);
    expect(await json(incoming[0])).toEqual(await json(incoming[1]));
    const outKey = crypto.randomUUID(),
      outgoing = await Promise.all([
        req("/attendance/check-out", "POST", {}, employeeCookie, outKey),
        req("/attendance/check-out", "POST", {}, employeeCookie, outKey),
      ]);
    expect(outgoing.map((r) => r.status)).toEqual([200, 200]);
    expect(await json(outgoing[0])).toEqual(await json(outgoing[1]));
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM attendance_sessions",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it("rejects expired pairing codes and expired display credentials", async () => {
    await env.DB.prepare(
      "UPDATE registered_tablets SET credential_expires_at=? WHERE id=?",
    )
      .bind(Math.floor(Date.now() / 1000) - 1, tabletId)
      .run();
    expect(
      (await req("/tablet/qr", "GET", undefined, tabletCookie)).status,
    ).toBe(401);
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    const res = await req("/tablets", "POST", {
        name: "Expired pair",
        pairingCode: "c".repeat(64),
      }),
      id = (await json<{ id: string }>(res)).id;
    await env.DB.prepare(
      "UPDATE registered_tablets SET pairing_expires_at=? WHERE id=?",
    )
      .bind(Math.floor(Date.now() / 1000) - 1, id)
      .run();
    expect(
      (await req("/tablet/pair", "POST", { code: "c".repeat(64) }, "")).status,
    ).toBe(400);
  });
  it("restricts paired displays to QR generation and consumes pairing codes once", async () => {
    const res = await req("/tablet/qr", "GET", undefined, tabletCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await json<{ token: string }>(res)).token).toMatch(/^ATBOT1:/);
    expect(
      (await req("/employees", "GET", undefined, tabletCookie)).status,
    ).toBe(401);
    expect(
      (await req("/tablet/pair", "POST", { code: "a".repeat(64) }, "")).status,
    ).toBe(400);
    const tablets = await json<{ tablets: Record<string, unknown>[] }>(
      await req("/tablets"),
    );
    expect(JSON.stringify(tablets)).not.toContain("credential_hash");
    expect(JSON.stringify(tablets)).not.toContain("pairing_hash");
    expect(
      await env.DB.prepare(
        "SELECT pairing_hash FROM registered_tablets WHERE id=?",
      )
        .bind(tabletId)
        .first(),
    ).toEqual({ pairing_hash: null });
  });
  it("rejects missing, expired, tampered and revoked QR registrations", async () => {
    expect((await req("/tablet/qr", "GET", undefined, "")).status).toBe(401);
    const old = await issueQR(
      tabletId,
      testBotToken,
      Math.floor(Date.now() / 1000) - 301,
    );
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: old.token },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: "ATBOT1:invalid.0000" },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    const qr = await currentQR();
    expect(
      (
        await req(`/tablets/${tabletId}/revoke`, "POST", {
          reason: "Test revoke",
        })
      ).status,
    ).toBe(200);
    expect(
      (await req("/tablet/qr", "GET", undefined, tabletCookie)).status,
    ).toBe(401);
    expect(
      (await req("/attendance/check-in", "POST", { qr }, employeeCookie))
        .status,
    ).toBe(400);
  });
  it("records one active session and safely replays check-in and checkout", async () => {
    const input = { qr: await currentQR() },
      key = crypto.randomUUID(),
      first = await req(
        "/attendance/check-in",
        "POST",
        input,
        employeeCookie,
        key,
      ),
      firstData = await json<{ id: string; checkIn: number }>(first);
    expect(first.status).toBe(201);
    expect(
      await json(
        await req("/attendance/check-in", "POST", input, employeeCookie, key),
      ),
    ).toEqual(firstData);
    expect(
      (await req("/attendance/check-in", "POST", input, employeeCookie)).status,
    ).toBe(409);
    const outKey = crypto.randomUUID(),
      out = await req(
        "/attendance/check-out",
        "POST",
        {},
        employeeCookie,
        outKey,
      ),
      outData = await json<{ checkOut: number }>(out);
    expect(out.status).toBe(200);
    expect(outData.checkOut).toBeGreaterThanOrEqual(firstData.checkIn);
    expect(
      await json(
        await req("/attendance/check-out", "POST", {}, employeeCookie, outKey),
      ),
    ).toEqual(outData);
    expect(
      (await req("/attendance/check-out", "POST", {}, employeeCookie)).status,
    ).toBe(409);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM attendance_sessions",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action IN ('attendance.check_in','attendance.check_out')",
      ).first<{ n: number }>())!.n,
    ).toBe(2);
  });
  it("supports multiple sessions and preserves exact integer timestamps", async () => {
    for (let n = 0; n < 2; n++) {
      expect(
        (
          await req(
            "/attendance/check-in",
            "POST",
            { qr: await currentQR() },
            employeeCookie,
          )
        ).status,
      ).toBe(201);
      expect(
        (await req("/attendance/check-out", "POST", {}, employeeCookie)).status,
      ).toBe(200);
    }
    const rows = (
      await env.DB.prepare(
        "SELECT check_in,check_out FROM attendance_sessions",
      ).all<{ check_in: number; check_out: number }>()
    ).results;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Number.isInteger(r.check_in)).toBe(true);
      expect(r.check_out).toBeGreaterThanOrEqual(r.check_in);
    }
  });
  it("allows a current shared QR to serve different employees independently", async () => {
    expect(
      (
        await req("/employees", "POST", {
          fullName: "Employee Two",
          telegramId: "200002",
          levelId,
          activationDate: localDate(),
        })
      ).status,
    ).toBe(201);
    const other = await login(200002),
      qr = await currentQR();
    expect(
      (await req("/attendance/check-in", "POST", { qr }, employeeCookie))
        .status,
    ).toBe(201);
    expect(
      (await req("/attendance/check-in", "POST", { qr }, other)).status,
    ).toBe(201);
  });
  it("rejects supplied identities and keeps employee records private", async () => {
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR(), employeeId: "another" },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    for (const path of [
      "/attendance/live",
      "/attendance/people",
      "/schedules?employeeId=" + employeeId,
      "/tablets",
    ])
      expect((await req(path, "GET", undefined, employeeCookie)).status).toBe(
        403,
      );
    expect((await req("/attendance/mine", "GET", undefined, root)).status).toBe(
      403,
    );
    const mine = await json<{ days: unknown[] }>(
      await req("/attendance/mine", "GET", undefined, employeeCookie),
    );
    expect(mine.days.length).toBeGreaterThan(0);
  });
  it("blocks disabled employees and validates registration inside the database transaction", async () => {
    const qr = await currentQR();
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?")
      .bind(userId)
      .run();
    expect(
      (await req("/attendance/check-in", "POST", { qr }, employeeCookie))
        .status,
    ).toBe(401);
    await expect(
      env.DB.prepare(
        "INSERT INTO attendance_sessions(id,employee_id,work_date,check_in,tablet_id,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          employeeId,
          localDate(),
          Math.floor(Date.now() / 1000),
          tabletId,
          Math.floor(Date.now() / 1000),
        )
        .run(),
    ).rejects.toThrow(/ATBOT_CONFLICT/);
  });
  it("makes concurrent distinct-key check-ins atomic", async () => {
    const input = { qr: await currentQR() },
      results = await Promise.all([
        req("/attendance/check-in", "POST", input, employeeCookie),
        req("/attendance/check-in", "POST", input, employeeCookie),
      ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM attendance_sessions",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it("makes concurrent checkout transitions atomic without duplicate audit", async () => {
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    const results = await Promise.all([
      req("/attendance/check-out", "POST", {}, employeeCookie),
      req("/attendance/check-out", "POST", {}, employeeCookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='attendance.check_out'",
      ).first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it("protects regular schedule snapshots once attendance exists", async () => {
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await req("/schedules/override", "POST", {
          employeeId,
          date: localDate(),
          startMinute: 100,
          endMinute: 900,
          cancelled: false,
          reason: "Attempted rewrite",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await req("/schedules/weekly", "POST", {
          employeeId,
          weekday: 0,
          startMinute: 100,
          endMinute: 900,
          effectiveDate: localDate(),
          reason: "Attempted rewrite",
        })
      ).status,
    ).toBe(409);
    const rows = (
      await env.DB.prepare(
        "SELECT start_at,end_at FROM scheduled_shifts WHERE employee_id=?",
      )
        .bind(employeeId)
        .all<{ start_at: number; end_at: number }>()
    ).results;
    expect(rows[0].start_at).toBe(dayStart(localDate()));
  });
  it("applies an override before recurring hours and supports cancellation", async () => {
    expect(
      (
        await req("/schedules/override", "POST", {
          employeeId,
          date: localDate(),
          startMinute: 480,
          endMinute: 1020,
          cancelled: false,
          reason: "Adjusted day",
        })
      ).status,
    ).toBe(200);
    const path = `/schedules?employeeId=${employeeId}&from=${localDate()}`,
      first = await json<{ shifts: { start_at: number }[] }>(await req(path));
    expect(first.shifts[0].start_at).toBe(dayStart(localDate()) + 480 * 60);
    expect(
      (
        await req("/schedules/override", "POST", {
          employeeId,
          date: localDate(),
          startMinute: 0,
          endMinute: 0,
          cancelled: true,
          reason: "Day cancelled",
        })
      ).status,
    ).toBe(200);
    expect(
      (await json<{ shifts: { status: string }[] }>(await req(path))).shifts[0]
        .status,
    ).toBe("cancelled");
  });
  it("flags forgotten sessions, excludes open earnings, and audits an admin close", async () => {
    const time = Math.floor(Date.now() / 1000),
      id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO attendance_sessions(id,employee_id,work_date,check_in,tablet_id,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, employeeId, localDate(), time - 19 * 3600, tabletId, time)
      .run();
    const mine = await json<{
      summary: { estimatedGross: number; pending: boolean };
    }>(await req("/attendance/mine", "GET", undefined, employeeCookie));
    expect(mine.summary.estimatedGross).toBe(0);
    expect(mine.summary.pending).toBe(true);
    const live = await json<{ employees: { forgotten: boolean }[] }>(
      await req("/attendance/live"),
    );
    expect(live.employees[0].forgotten).toBe(true);
    expect(
      (
        await req(`/attendance/${id}/close`, "POST", {
          checkout: time - 18 * 3600,
          reason: "Confirmed actual departure",
        })
      ).status,
    ).toBe(200);
    const stored = await env.DB.prepare(
      "SELECT checkout_source,checkout_reason,check_out FROM attendance_sessions WHERE id=?",
    )
      .bind(id)
      .first();
    expect(stored).toEqual({
      checkout_source: "admin",
      checkout_reason: "Confirmed actual departure",
      check_out: time - 18 * 3600,
    });
    expect(
      (
        await req(`/attendance/${id}/close`, "POST", {
          checkout: time,
          reason: "Duplicate close",
        })
      ).status,
    ).toBe(409);
  });
  it("enforces checkout bounds and overtime interval bounds", async () => {
    const result = await json<{ id: string; checkIn: number }>(
      await req(
        "/attendance/check-in",
        "POST",
        { qr: await currentQR() },
        employeeCookie,
      ),
    );
    expect(
      (
        await req(`/attendance/${result.id}/close`, "POST", {
          checkout: result.checkIn - 1,
          reason: "Wrong departure",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/overtime", "POST", {
          employeeId,
          date: localDate(),
          start: dayStart(localDate()) - 60,
          end: dayStart(localDate()) + 60,
          reason: "Outside day",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req("/attendance/overtime", "POST", {
          employeeId,
          date: localDate(),
          start: dayStart(localDate()) + 3600,
          end: dayStart(localDate()) + 7200,
          reason: "Authorized work",
        })
      ).status,
    ).toBe(201);
  });
  it("returns useful errors for invalid query dates and range lengths", async () => {
    expect((await req("/attendance/live?date=invalid")).status).toBe(400);
    expect(
      (
        await req(
          `/schedules?employeeId=${employeeId}&from=2026-01-01&to=2026-12-31`,
        )
      ).status,
    ).toBe(400);
  });
  it("uses secure scoped display cookies in production", async () => {
    await req("/tablets", "POST", {
      name: "Second display",
      pairingCode: "b".repeat(64),
    });
    env.APP_ENV = "production";
    env.APP_ORIGIN = "https://app.example";
    const res = await app.request(
      "https://app.example/api/tablet/pair",
      {
        method: "POST",
        headers: { Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ code: "b".repeat(64) }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__Secure-atbot_tablet=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("Secure");
    expect(res.headers.get("set-cookie")).toContain("Path=/api/tablet");
  });
});

describe("Production reception and correction safeguards", () => {
  it("pairs permanently and refreshes the secure browser credential", async () => {
    const row = await env.DB.prepare(
      "SELECT credential_expires_at FROM registered_tablets WHERE id=?",
    )
      .bind(tabletId)
      .first<any>();
    expect(row.credential_expires_at).toBeNull();
    const response = await req("/tablet/qr", "GET", undefined, tabletCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=34560000");
  });
  it("requires a fresh registered QR for checkout and leaves failed attempts open", async () => {
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    expect(
      (await req("/attendance/check-out", "POST", undefined, employeeCookie))
        .status,
    ).toBe(400);
    const expired = await issueQR(
      tabletId,
      testBotToken,
      Math.floor(Date.now() / 1000) - 61,
    );
    expect(
      (
        await req(
          "/attendance/check-out",
          "POST",
          { qr: expired.token },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await req(
          "/attendance/check-out",
          "POST",
          { qr: "tampered" },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM attendance_sessions WHERE check_out IS NULL",
        ).first<any>()
      ).n,
    ).toBe(1);
    expect(
      (await req("/tablets/" + tabletId + "/revoke", "POST", { reason: "" }))
        .status,
    ).toBe(200);
    expect(
      (
        await req(
          "/attendance/check-out",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM attendance_closures",
        ).first<any>()
      ).n,
    ).toBe(0);
  });
  it("prevents unaudited recorded-day changes at the database boundary", async () => {
    const schedule = await json<any>(
      await req(
        `/schedules?employeeId=${employeeId}&from=${localDate()}&to=${localDate()}`,
      ),
    );
    expect(
      (
        await req(
          "/attendance/check-in",
          "POST",
          { qr: await currentQR() },
          employeeCookie,
        )
      ).status,
    ).toBe(201);
    await expect(
      env.DB.prepare(
        "UPDATE scheduled_shifts SET start_at=start_at+60 WHERE id=?",
      )
        .bind(schedule.shifts[0].id)
        .run(),
    ).rejects.toThrow("ATBOT_CONFLICT");
  });
});
