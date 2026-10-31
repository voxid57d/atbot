import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
const vars = readFileSync(".dev.vars", "utf8");
if (
  !/^APP_ENV=development$/m.test(vars) ||
  !/^TELEGRAM_BOT_TOKEN=local-only-test-token$/m.test(vars)
)
  throw new Error(
    "This utility is restricted to the supplied fake local credentials.",
  );
const id = process.argv[2] ?? "100001";
if (!/^[1-9]\d{0,15}$/.test(id))
  throw new Error("Expected numeric Telegram user ID");
const params = new URLSearchParams({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: crypto.randomUUID(),
  user: JSON.stringify({
    id: Number(id),
    first_name: "Local",
    last_name: "Administrator",
  }),
});
const check = [...params.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");
const key = createHmac("sha256", "WebAppData")
  .update("local-only-test-token")
  .digest();
params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
console.log(
  "Paste this into the development-only login field (valid for 5 minutes, one use):\n",
);
console.log(params.toString());
