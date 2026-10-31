import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// The current JSONC config has trailing commas and no comments.
const config = JSON.parse(
  readFileSync("wrangler.jsonc", "utf8").replace(/,\s*([}\]])/g, "$1"),
);
assert.equal(config.name, "staff-attendance-api");
assert.equal(config.d1_databases.length, 1);
assert.deepEqual(config.d1_databases[0], {
  binding: "DB",
  database_name: "staff-attendance-db",
  database_id: "0d6fc486-37ad-4639-a199-00f92e765778",
  migrations_dir: "database/migrations",
});
assert.equal(config.vars.APP_ENV, "production");
assert.equal(
  config.vars.APP_ORIGIN,
  "https://staff.eshtaylakov.uz",
);
assert.deepEqual(config.routes, [
  { pattern: "staff.eshtaylakov.uz", custom_domain: true },
]);
assert.equal(config.workers_dev, true);
assert.equal(config.vars.NOTIFICATIONS_ENABLED, "true");
assert.deepEqual(config.triggers.crons, ["* * * * *"]);
assert.equal(config.assets.binding, "ASSETS");
assert.deepEqual(config.assets.run_worker_first, ["/api/*", "/"]);
assert.equal(config.observability.enabled, true);
for (const key of [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "BOOTSTRAP_TELEGRAM_ID",
])
  assert.equal(
    config.vars[key],
    undefined,
    "Credentials belong in encrypted secrets",
  );
function walk(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      /\.(js|mjs|ts|tsx|json|webmanifest|html|svg|css|map)$/.test(entry.name)
    ) {
      const text = readFileSync(path, "utf8");
      assert.ok(
        !/\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/.test(text),
        `Potential bot credential in ${path}`,
      );
      assert.ok(
        !text.includes("local-only-test-token"),
        `Fake test credential in ${path}`,
      );
    }
  }
}
for (const directory of ["frontend", "public", "dist"]) walk(directory);
const builtJS = readFileSync("dist/index.html", "utf8").match(
  /src="(\/assets\/[^\"]+\.js)"/,
)?.[1];
assert.ok(builtJS);
console.log(
  "Release configuration passed: existing resources, HTTPS production vars, cron/assets/logging, no secret values or fake bot credentials in public source/build. Local-login UI absence is checked in the bundled browser rehearsal.",
);
