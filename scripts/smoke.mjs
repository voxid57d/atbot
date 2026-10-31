// Rehearse against the running local Worker only. Uses the fake development credentials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
const vars = readFileSync(".dev.vars", "utf8");
assert.match(vars, /^APP_ENV=development$/m);
assert.match(vars, /^TELEGRAM_BOT_TOKEN=local-only-test-token$/m);
const base = "http://127.0.0.1:5173";
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /IELTS ZONE/);
const health = await fetch(base + "/api/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).phase, 6);
const forbidden = await fetch(base + "/api/employees");
assert.equal(forbidden.status, 401);
const params = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: crypto.randomUUID(),
  user: JSON.stringify({
    id: 100001,
    first_name: "Local",
    last_name: "Administrator",
  }),
});
const check = [...params]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");
const secret = createHmac("sha256", "WebAppData")
  .update("local-only-test-token")
  .digest();
params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
const headers = { Origin: base, "Content-Type": "application/json" };
const login = await fetch(base + "/api/auth/telegram", {
  method: "POST",
  headers,
  body: JSON.stringify({ initData: params.toString() }),
});
assert.equal(login.status, 200);
assert.match(login.headers.get("set-cookie"), /HttpOnly/);
const cookie = login.headers.get("set-cookie").split(";")[0];
try {
  const me = await fetch(base + "/api/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.access, "super_admin");
  const catalog = await fetch(base + "/api/catalog", {
    headers: { Cookie: cookie },
  });
  assert.equal(catalog.status, 200);
  assert.ok((await catalog.json()).roles.length >= 4);
  const replay = await fetch(base + "/api/auth/telegram", {
    method: "POST",
    headers,
    body: JSON.stringify({ initData: params.toString() }),
  });
  assert.equal(replay.status, 409);
} finally {
  const logout = await fetch(base + "/api/auth/logout", {
    method: "POST",
    headers: { ...headers, Cookie: cookie },
    body: "{}",
  });
  assert.equal(logout.status, 200);
}
console.log(
  "Local HTTP smoke passed: frontend, D1 health, protected routes, signed login, cookie session, catalog, replay rejection, logout.",
);
