export const TIMEZONE = "Asia/Tashkent";
export const CURRENCY = "UZS";
export const permissions = [
  "employees.manage",
  "salary.manage",
  "payroll.approve",
  "attendance.manage",
  "audit.view",
] as const;
export type Permission = (typeof permissions)[number];
export type Access = "employee" | "admin" | "super_admin";
export interface Identity {
  id: string;
  telegramId: string;
  fullName: string;
  access: Access;
  permissions: Permission[];
}
export function can(user: Identity, permission: Permission) {
  return (
    user.access === "super_admin" ||
    (user.access === "admin" && user.permissions.includes(permission))
  );
}
export function localDate(timestamp = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function formatMoney(amount: number) {
  return (
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      amount,
    ) + " UZS"
  );
}
