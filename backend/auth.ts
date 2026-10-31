import { HTTPException } from "hono/http-exception";
const encoder = new TextEncoder();
export async function sha256(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function hmac(key: Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", imported, encoder.encode(value)),
  );
}
export async function verifyTelegram(
  initData: string,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
  maxAgeSeconds = 300,
) {
  const fail = () => {
    throw new HTTPException(401, {
      message: "Invalid or expired Telegram login. Reopen the Mini App.",
    });
  };
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) fail();
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) fail();
  const authDate = Number(params.get("auth_date"));
  if (
    !Number.isSafeInteger(authDate) ||
    authDate <= 0 ||
    now - authDate > maxAgeSeconds ||
    authDate - now > 30
  )
    fail();
  const check = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(encoder.encode("WebAppData"), botToken);
  const expected = await hmac(secret, check);
  const supplied = Uint8Array.from(hash!.match(/../g)!, (v) => parseInt(v, 16));
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected[i] ^ supplied[i];
  if (difference !== 0) fail();
  let user: { id: number; first_name?: string; last_name?: string };
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    return fail();
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return fail();
  return {
    telegramId: String(user.id),
    fullName:
      [user.first_name, user.last_name]
        .filter(Boolean)
        .join(" ")
        .slice(0, 100) || "Administrator",
    loginHash: hash!,
    expiresAt: authDate + 301,
  };
}
