import { z } from "zod";
import { permissions } from "./domain";
export const telegramId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine((v) => Number.isSafeInteger(Number(v)), "Invalid Telegram ID");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const name = z.string().trim().min(2).max(100);
export const reason = z.string().trim().max(1000).default("");
export const loginSchema = z
  .object({ initData: z.string().min(1).max(12000) })
  .strict();
export const employeeSchema = z
  .object({
    fullName: name,
    telegramId,
    levelId: z.string().min(1).max(100),
    activationDate: date,
  })
  .strict();
export const employeeUpdateSchema = z
  .object({
    fullName: name.optional(),
    active: z.boolean().optional(),
    levelId: z.string().min(1).max(100).optional(),
    effectiveDate: date.optional(),
    reason,
  })
  .strict()
  .refine(
    (v) =>
      v.fullName !== undefined ||
      v.active !== undefined ||
      v.levelId !== undefined,
    "No changes supplied",
  );
export const linkSchema = z.object({ telegramId, reason }).strict();
export const deleteEmployeeSchema = z
  .object({ confirmName: z.string().max(100), reason })
  .strict();
export const roleSchema = z.object({ name }).strict();
export const levelSchema = z
  .object({
    name,
    hourlyRate: z.number().int().min(0).max(1_000_000_000),
    effectiveDate: date,
  })
  .strict();
export const rateSchema = levelSchema.omit({ name: true }).extend({ reason });
export const catalogUpdateSchema = z
  .object({ name: name.optional(), active: z.boolean().optional(), reason })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.active !== undefined,
    "No changes supplied",
  );
export const accessSchema = z
  .object({
    access: z.enum(["employee", "admin"]),
    permissions: z.array(z.enum(permissions)).max(permissions.length),
    reason,
  })
  .strict()
  .refine(
    (v) => v.access === "admin" || v.permissions.length === 0,
    "Employees cannot hold admin permissions",
  );
