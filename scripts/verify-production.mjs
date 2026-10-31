// Read-only app checks, plus one deliberately invalid login (no account/session creation).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const base = "https://staff.eshtaylakov.uz";
const page = await fetch(base);
assert.equal(page.status, 200, "Frontend HTTP status");
const html = await page.text();
assert.match(html, /IELTS ZONE/, "Expected application HTML");
const expectedScript = readFileSync("dist/index.html", "utf8").match(
  /src="(\/assets\/[^\"]+\.js)"/,
)?.[1];
assert.ok(expectedScript, "Expected local production JavaScript bundle");
assert.ok(
  html.includes(expectedScript),
  "Live HTML references the current tested build",
);
assert.ok(
  page.headers.get("content-security-policy"),
  "Content Security Policy",
);
assert.ok(page.headers.get("strict-transport-security"), "HTTPS policy");
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)];
assert.ok(assets.length >= 2, "Expected JS and CSS assets");
for (const match of assets) {
  const response = await fetch(base + match[1]);
  assert.equal(response.status, 200, "Static asset HTTP status");
  if (match[1] === expectedScript)
    assert.match(
      await response.text(),
      /X-Telegram-Init-Data/,
      "Live client includes current Telegram account binding",
    );
}
const health = await fetch(base + "/api/health");
assert.equal(health.status, 200, "API health HTTP status");
assert.deepEqual(await health.json(), { status: "ok", phase: 6 });
for (const path of [
  "/api/me",
  "/api/employees",
  "/api/catalog",
  "/api/attendance/mine",
  "/api/requests/mine",
  "/api/requests/review",
  "/api/notifications/preferences",
  "/api/notifications/messages",
  "/api/notifications/messages/users",
  "/api/attendance/live",
  "/api/attendance/manual",
  "/api/tablets",
  "/api/tablet/qr",
  "/api/discipline/mine",
  "/api/discipline/review",
  "/api/discipline/today",
  "/api/payroll/preview",
  "/api/payroll/mine",
  "/api/payroll/history",
  "/api/payroll/export",
  "/api/debtors",
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 401, "Unauthenticated private API protection");
  assert.equal(response.headers.get("cache-control"), "no-store");
}
const reception = await fetch(base + "/reception/");
assert.equal(reception.status, 200, "Reception shell HTTP status");
assert.match(reception.headers.get("content-type") ?? "", /text\/html/);
const manifest = await fetch(base + "/reception/manifest.webmanifest");
assert.equal(manifest.status, 200, "PWA manifest HTTP status");
const manifestData = await manifest.json();
assert.equal(manifestData.scope, "/reception/");
for (const size of [192, 512]) {
  const icon = manifestData.icons.find((i) => i.sizes === `${size}x${size}`);
  assert.equal(icon?.type, "image/png");
  const response = await fetch(base + icon.src);
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
const sw = await fetch(base + "/reception/sw.js");
assert.equal(sw.status, 200, "Service worker HTTP status");
assert.match(sw.headers.get("content-type") ?? "", /javascript/);
assert.match(await sw.text(), /never cache API responses or QR data/);
assert.equal(
  (await fetch(base + "/reception/icon.svg")).status,
  200,
  "PWA icon HTTP status",
);
const invalid = await fetch(base + "/api/auth/telegram", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ initData: "invalid" }),
});
assert.equal(
  invalid.status,
  401,
  "Configured Telegram authentication rejects invalid login",
);
console.log(
  "Phase 6 live checks passed: frontend/assets, CSP/HTTPS headers, full-schema D1 health, attendance/review/payroll/admin/tablet access boundaries, reception PWA files and PNG install icons, invalid Telegram login rejection.",
);
