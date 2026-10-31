import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { AppEnv } from "./types";
import { sha256 } from "./auth";
import { body, isLocal, now } from "./http";
const payloadSchema = z
  .object({
    v: z.literal(1),
    d: z.string().uuid(),
    e: z.number().int(),
    w: z.number().int(),
  })
  .strict();
export async function qrSignature(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode("ATBOT_QR_V1:" + value),
      ),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function issueQR(tabletId: string, secret: string, time = now()) {
  const w = time,
    e = w + 60,
    encoded = btoa(JSON.stringify({ v: 1, d: tabletId, e, w }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  return {
    token: "ATBOT1:" + encoded + "." + (await qrSignature(encoded, secret)),
    expiresAt: e,
    serverTime: time,
  };
}
export async function verifyQR(token: string, secret: string, time = now()) {
  const fail = () => {
    throw new HTTPException(400, {
      message:
        "This QR is invalid or expired. Scan the current reception code.",
    });
  };
  if (token.length > 600 || !token.startsWith("ATBOT1:")) return fail();
  const [encoded, signature, ...rest] = token.slice(7).split(".");
  if (
    rest.length ||
    !encoded ||
    !/^[a-zA-Z0-9_-]+$/.test(encoded) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return fail();
  const expected = await qrSignature(encoded, secret);
  let diff = 0;
  for (let i = 0; i < 64; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff) return fail();
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(
      JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))),
    );
  } catch {
    return fail();
  }
  if (payload.e !== payload.w + 60 || time < payload.w || time >= payload.e)
    return fail();
  return payload;
}
export const tabletPublic = new Hono<AppEnv>();
const tabletCookie = (local: boolean) =>
  local ? "atbot_tablet" : "__Secure-atbot_tablet";
tabletPublic.post("/pair", async (c) => {
  const { code } = await body(
    c,
    z.object({ code: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  );
  const credential = crypto.randomUUID() + crypto.randomUUID();
  const row = await c.env.DB.prepare(
    "UPDATE registered_tablets SET credential_hash=?,credential_expires_at=NULL,pairing_hash=NULL,pairing_expires_at=NULL WHERE pairing_hash=? AND pairing_expires_at>? AND revoked_at IS NULL AND credential_hash IS NULL RETURNING id",
  )
    .bind(await sha256(credential), await sha256(code), now())
    .first();
  if (!row)
    throw new HTTPException(400, {
      message:
        "Pairing code is invalid, expired, or already used. Ask a super administrator for a new registration.",
    });
  setCookie(c, tabletCookie(isLocal(c)), credential, {
    httpOnly: true,
    secure: !isLocal(c),
    sameSite: "Strict",
    path: "/api/tablet",
    maxAge: 400 * 86400,
  });
  return c.json({ ok: true });
});
tabletPublic.get("/qr", async (c) => {
  const credential = getCookie(c, tabletCookie(isLocal(c)));
  if (!credential)
    throw new HTTPException(401, {
      message: "Register this reception display first.",
    });
  const tablet = await c.env.DB.prepare(
    "SELECT id,name FROM registered_tablets WHERE credential_hash=? AND (credential_expires_at IS NULL OR credential_expires_at>?) AND revoked_at IS NULL",
  )
    .bind(await sha256(credential), now())
    .first<{ id: string; name: string }>();
  if (!tablet)
    throw new HTTPException(401, {
      message: "This display registration expired or was revoked.",
    });
  if (!c.env.TELEGRAM_BOT_TOKEN)
    throw new HTTPException(503, { message: "QR signing is not configured." });
  // Refresh the browser cookie too, including displays paired before this release.
  setCookie(c, tabletCookie(isLocal(c)), credential, {
    httpOnly: true,
    secure: !isLocal(c),
    sameSite: "Strict",
    path: "/api/tablet",
    maxAge: 400 * 86400,
  });
  return c.json({
    ...(await issueQR(tablet.id, c.env.TELEGRAM_BOT_TOKEN)),
    name: tablet.name,
  });
});
