import type { Context } from "hono";
import type { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./types";
import { can, type Permission } from "../shared/domain";
export type AppContext = Context<AppEnv>;
export const now = () => Math.floor(Date.now() / 1000);
export const isLocal = (c: AppContext) =>
  c.env.APP_ENV === "development" &&
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(c.req.url).hostname);
export async function body<T>(c: AppContext, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(c.get("rawBody"));
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body." });
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HTTPException(400, {
      message: result.error.issues
        .map((i) => `${i.path.join(".") || "Request"}: ${i.message}`)
        .join("; "),
    });
  return result.data;
}
export function requirePermission(c: AppContext, p: Permission) {
  if (!can(c.get("identity"), p))
    throw new HTTPException(403, {
      message: "You do not have permission for this action.",
    });
}
export function superAdmin(c: AppContext) {
  if (c.get("identity").access !== "super_admin")
    throw new HTTPException(403, {
      message: "Super administrator permission required.",
    });
}
