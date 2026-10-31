// Local HTTP rehearsal only. Creates clearly marked local test records, then disables/revokes them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
const vars = readFileSync(".dev.vars", "utf8");
assert.match(vars, /^APP_ENV=development$/m);
assert.match(vars, /^TELEGRAM_BOT_TOKEN=local-only-test-token$/m);
assert.match(vars, /^BOOTSTRAP_TELEGRAM_ID=100001$/m);
const base = "http://127.0.0.1:5173",
  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now()),
  suffix = randomUUID().slice(0, 8),
  tgId = 300000000 + Math.floor(Math.random() * 500000000);
async function req(path, method = "GET", data, cookie = "") {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value = await res.json();
  assert.ok(res.ok, `${method} ${path}: ${res.status} ${value.error ?? ""}`);
  return { res, value };
}
async function login(id) {
  const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: randomUUID(),
      user: JSON.stringify({
        id,
        first_name: "Local",
        last_name: "Smoke test",
      }),
    }),
    check = [...params]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    secret = createHmac("sha256", "WebAppData")
      .update("local-only-test-token")
      .digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return (
    await req("/auth/telegram", "POST", { initData: params.toString() })
  ).res.headers
    .get("set-cookie")
    .split(";")[0];
}
let root = "",
  employeeCookie = "",
  employeeId = "",
  tabletId = "",
  levelId = "";
try {
  for (const path of [
    "/reception/",
    "/reception/manifest.webmanifest",
    "/reception/sw.js",
    "/reception/icon.svg",
  ])
    assert.equal((await fetch(base + path)).status, 200, path);
  const manifest = await (
    await fetch(base + "/reception/manifest.webmanifest")
  ).json();
  assert.equal(manifest.scope, "/reception/");
  root = await login(100001);
  levelId = (
    await req(
      "/roles/office-manager/levels",
      "POST",
      {
        name: "LOCAL SMOKE " + suffix,
        hourlyRate: 12000,
        effectiveDate: today,
      },
      root,
    )
  ).value.id;
  employeeId = (
    await req(
      "/employees",
      "POST",
      {
        fullName: "LOCAL SMOKE " + suffix,
        telegramId: String(tgId),
        levelId,
        activationDate: today,
      },
      root,
    )
  ).value.id;
  await req(
    "/schedules/weekly",
    "POST",
    {
      employeeId,
      weekday: new Date(today + "T00:00:00Z").getUTCDay(),
      startMinute: 0,
      endMinute: 1439,
      effectiveDate: today,
      reason: "Local HTTP rehearsal",
    },
    root,
  );
  const code = randomBytes(32).toString("hex");
  tabletId = (
    await req(
      "/tablets",
      "POST",
      { name: "LOCAL SMOKE " + suffix, pairingCode: code },
      root,
    )
  ).value.id;
  const tabletCookie = (await req("/tablet/pair", "POST", { code })).res.headers
    .get("set-cookie")
    .split(";")[0];
  employeeCookie = await login(tgId);
  for (let n = 0; n < 2; n++) {
    const display = (await req("/tablet/qr", "GET", undefined, tabletCookie))
      .value;
    assert.match(display.token, /^ATBOT1:/);
    const incoming = (
      await req(
        "/attendance/check-in",
        "POST",
        { qr: display.token },
        employeeCookie,
      )
    ).value;
    assert.ok(Number.isInteger(incoming.checkIn));
    const mine = (
      await req("/attendance/mine", "GET", undefined, employeeCookie)
    ).value;
    assert.equal(mine.active.id, incoming.id);
    const outgoing = (
      await req("/attendance/check-out", "POST", {}, employeeCookie)
    ).value;
    assert.ok(outgoing.checkOut >= incoming.checkIn);
  }
  const mine = (await req("/attendance/mine", "GET", undefined, employeeCookie))
    .value;
  assert.equal(mine.active, null);
  assert.equal(mine.days.flatMap((d) => d.sessions).length, 2);
  const live = (await req("/attendance/live", "GET", undefined, root)).value;
  assert.equal(
    live.employees.find((e) => e.id === employeeId).status,
    "Finished",
  );
  console.log(
    "Phase 2 local HTTP smoke passed: PWA assets, display pairing, signed QR, employee check-in/out, two sessions, own summary and admin live attendance.",
  );
} finally {
  if (tabletId)
    await req(
      `/tablets/${tabletId}/revoke`,
      "POST",
      { reason: "Local rehearsal complete" },
      root,
    );
  if (employeeCookie) await req("/auth/logout", "POST", {}, employeeCookie);
  if (employeeId)
    await req(
      `/employees/${employeeId}`,
      "PATCH",
      { active: false, reason: "Local rehearsal complete" },
      root,
    );
  if (levelId)
    await req(
      `/levels/${levelId}`,
      "PATCH",
      { active: false, reason: "Local rehearsal complete" },
      root,
    );
  if (root) await req("/auth/logout", "POST", {}, root);
}
