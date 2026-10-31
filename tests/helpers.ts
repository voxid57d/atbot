import { createHmac } from "node:crypto";
export const testBotToken = "test-bot-token";
export function signedLogin(
  id = 100001,
  authDate = Math.floor(Date.now() / 1000),
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: crypto.randomUUID(),
    user: JSON.stringify({ id, first_name: "Test", last_name: "Person" }),
    ...extra,
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(testBotToken)
    .digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
