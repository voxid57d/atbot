import { now } from "./http";

// All transitions run in one D1 transaction. A concurrent QR checkout wins if
// committed first; retries never replace an existing checkout.
export async function automaticCheckout(db: D1Database, time = now()) {
  const cutoff = "unixepoch(work_date || 'T23:00:00+05:00')";
  const eligible = `check_out IS NULL AND ${cutoff}<=? AND check_in<=${cutoff}
    AND NOT EXISTS(SELECT 1 FROM payroll_period_locks WHERE work_date BETWEEN from_date AND to_date)`;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO attendance_closures(session_id,closed_at)
      SELECT id,${cutoff} FROM attendance_sessions WHERE ${eligible}`).bind(time),
    db.prepare(`INSERT OR IGNORE INTO automatic_checkouts(session_id,closed_at,processed_at,reason)
      SELECT id,${cutoff},?,'Automatic checkout at 23:00 Asia/Tashkent'
      FROM attendance_sessions WHERE ${eligible}`).bind(time, time),
    db.prepare(`UPDATE attendance_sessions SET
      check_out=(SELECT closed_at FROM automatic_checkouts WHERE session_id=attendance_sessions.id),
      checkout_source=NULL, closed_by=NULL, checkout_reason='Automatic checkout at 23:00 Asia/Tashkent'
      WHERE check_out IS NULL AND EXISTS(SELECT 1 FROM automatic_checkouts WHERE session_id=attendance_sessions.id)`),
  ]);
}
