// Read-only protection checks and deliberately rejected requests; no business writes.
import assert from "node:assert/strict";
const base = "https://staff.eshtaylakov.uz";
for (const [path, options, status] of [
  [
    "/api/payroll/preview",
    { headers: { Cookie: "__Host-atbot_session=forged" } },
    401,
  ],
  [
    "/api/payroll/finalize",
    {
      method: "POST",
      headers: {
        Origin: "https://example.invalid",
        "Content-Type": "application/json",
      },
      body: "{}",
    },
    403,
  ],
  [
    "/api/auth/telegram",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    403,
  ],
  [
    "/api/auth/telegram",
    {
      method: "POST",
      headers: { Origin: base, "Content-Type": "text/plain" },
      body: "{}",
    },
    415,
  ],
  [
    "/api/auth/telegram",
    {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ initData: "x".repeat(17000) }),
    },
    413,
  ],
  [
    "/api/telegram/webhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "deliberately-invalid",
      },
      body: "{}",
    },
    403,
  ],
  [
    "/api/payroll/history",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.invalid",
        "Access-Control-Request-Method": "GET",
      },
    },
    403,
  ],
]) {
  const response = await fetch(base + path, options);
  assert.equal(response.status, status, `${options.method ?? "GET"} ${path}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("strict-transport-security") ?? "",
    /max-age=/,
  );
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(typeof (await response.json()).error, "string");
}
console.log(
  "Live security checks passed: forged sessions, cross-origin/missing-origin writes, content type/body limits, webhook secret, preflight and non-cacheable errors. No business records or messages created.",
);
