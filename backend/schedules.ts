import type { Shift } from "../shared/attendance";
import { dateRange, dayStart } from "../shared/attendance";
import { now } from "./http";
type Weekly = {
  id: string;
  employee_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  effective_date: string;
  active: number;
  second_start_minute: number | null;
  second_end_minute: number | null;
};
type Override = {
  id: string;
  employee_id: string;
  work_date: string;
  start_minute: number;
  end_minute: number;
  cancelled: number;
  second_start_minute: number | null;
  second_end_minute: number | null;
  second_cancelled: number;
};
export async function getShiftsRange(
  db: D1Database,
  employeeId: string | null,
  from: string,
  to: string,
): Promise<(Shift & { employee_id: string })[]> {
  const filter = employeeId ? " WHERE employee_id=?" : "",
    args = employeeId ? [employeeId] : [];
  const batches = await db.batch([
    db
      .prepare(
        `SELECT * FROM weekly_schedules${filter}${filter ? " AND" : " WHERE"} effective_date<=? ORDER BY effective_date,id`,
      )
      .bind(...args, to),
    db
      .prepare(
        `SELECT * FROM shift_overrides${filter}${filter ? " AND" : " WHERE"} work_date BETWEEN ? AND ?`,
      )
      .bind(...args, from, to),
    db
      .prepare(
        `SELECT * FROM scheduled_shifts${filter}${filter ? " AND" : " WHERE"} work_date BETWEEN ? AND ?`,
      )
      .bind(...args, from, to),
    db
      .prepare(
        `SELECT id,activation_date,deactivation_date FROM employees${employeeId ? " WHERE id=?" : ""}`,
      )
      .bind(...args),
  ]);
  const weekly = batches[0].results as unknown as Weekly[],
    overrides = batches[1].results as unknown as Override[],
    existing = batches[2].results as unknown as (Shift & {
      employee_id: string;
    })[],
    employees = batches[3].results as unknown as {
      id: string;
      activation_date: string;
      deactivation_date: string | null;
    }[];
  const writes: {
      id: string;
      employeeId: string;
      date: string;
      start: number;
      end: number;
      source: string;
      slot: number;
    }[] = [],
    cancel: string[] = [];
  for (const employee of employees)
    for (const date of dateRange(from, to)) {
      if (
        date < employee.activation_date ||
        (employee.deactivation_date && date >= employee.deactivation_date)
      )
        continue;
      const override = overrides.find(
          (v) => v.employee_id === employee.id && v.work_date === date,
        ),
        weekday = new Date(date + "T00:00:00Z").getUTCDay(),
        rule = weekly
          .filter(
            (v) =>
              v.employee_id === employee.id &&
              v.weekday === weekday &&
              v.effective_date <= date,
          )
          .at(-1),
        source = override ?? rule;
      for (const slot of [1, 2]) {
        const stored = existing.find(
          (s) => s.employee_id === employee.id && s.work_date === date &&
            s.kind === "regular" && s.slot === slot,
        );
        const enabled = slot === 1
          ? (override ? !override.cancelled : !!rule?.active)
          : source?.second_start_minute != null &&
            (override ? !override.second_cancelled : !!rule?.active);
        if (!enabled) {
          if (stored && stored.status !== "cancelled") cancel.push(stored.id);
          continue;
        }
        const startMinute = slot === 1 ? source!.start_minute : source!.second_start_minute!;
        const endMinute = slot === 1 ? source!.end_minute : source!.second_end_minute!;
        const start = dayStart(date) + startMinute * 60;
        const end = dayStart(date) + endMinute * 60;
        if (stored?.start_at === start && stored.end_at === end && stored.status === "scheduled")
          continue;
        writes.push({
          id: stored?.id ?? `regular:${employee.id}:${date}${slot === 2 ? ":2" : ""}`,
          employeeId: employee.id,
          date,
          start,
          end,
          source: source!.id,
          slot,
        });
      }
    }
  const statements: D1PreparedStatement[] = [];
  // Clear changing windows atomically before replacing them, so moving both
  // shifts never conflicts with the previous second window. Recorded days stay frozen.
  const replacing = [...new Set([...cancel, ...writes.map((w) => w.id)])];
  if (replacing.length)
    statements.push(
      db
        .prepare(
          "UPDATE scheduled_shifts SET status='cancelled' WHERE id IN(SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=scheduled_shifts.employee_id AND work_date=scheduled_shifts.work_date)",
        )
        .bind(JSON.stringify(replacing)),
    );
  if (writes.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO scheduled_shifts(id,employee_id,work_date,start_at,end_at,kind,status,source_id,created_at,slot)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.employeeId'),json_extract(value,'$.date'),json_extract(value,'$.start'),json_extract(value,'$.end'),'regular','scheduled',json_extract(value,'$.source'),?,json_extract(value,'$.slot') FROM json_each(?) WHERE 1
  ON CONFLICT(employee_id,work_date,slot) WHERE kind='regular' DO UPDATE SET start_at=excluded.start_at,end_at=excluded.end_at,status='scheduled',source_id=excluded.source_id
  WHERE NOT EXISTS(SELECT 1 FROM effective_attendance WHERE employee_id=scheduled_shifts.employee_id AND work_date=scheduled_shifts.work_date)`,
        )
        .bind(now(), JSON.stringify(writes)),
    );
  if (statements.length) await db.batch(statements);
  return (
    await db
      .prepare(
        `SELECT * FROM scheduled_shifts${filter}${filter ? " AND" : " WHERE"} work_date BETWEEN ? AND ? ORDER BY work_date,start_at,id`,
      )
      .bind(...args, from, to)
      .all<Shift & { employee_id: string }>()
  ).results;
}
