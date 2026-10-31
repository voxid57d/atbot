import { dateRange } from "../shared/attendance";
import type { Shift, Session } from "../shared/attendance";
import { clock, hours } from "./ui";

export type CalendarAbsence = { work_date: string; paid: number };
export type CalendarCoverage = {
  work_date: string;
  start_at: number;
  end_at: number;
  status: string;
};
export function ScheduleCalendar({
  from,
  to,
  shifts,
  absences,
  coverage,
  sessions,
  onEdit,
  locked,
}: {
  from: string;
  to: string;
  shifts: Shift[];
  absences: CalendarAbsence[];
  coverage: CalendarCoverage[];
  sessions: (Session & { work_date: string })[];
  onEdit: (shift: Shift) => void;
  locked: (date: string) => boolean;
}) {
  return (
    <section
      aria-label="Weekly schedule calendar"
      className="schedule-calendar"
    >
      {dateRange(from, to).map((date) => {
        const dayShifts = shifts.filter((s) => s.work_date === date);
        const daySessions = sessions.filter((s) => s.work_date === date);
        return (
          <article key={date} className="calendar-day">
            <header>
              <strong>
                {new Intl.DateTimeFormat("en-GB", {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(date + "T12:00:00Z"))}
              </strong>
              <time>{date}</time>
            </header>
            {dayShifts.map((s) => (
              <div
                key={s.id}
                className={`calendar-shift ${s.status === "cancelled" ? "cancelled" : ""}`}
              >
                <strong>
                  {clock(s.start_at).slice(0, 5)}–{clock(s.end_at).slice(0, 5)}
                </strong>
                <small>
                  {s.status === "cancelled"
                    ? "Cancelled"
                    : s.kind === "extra"
                      ? "Extra shift"
                      : "Regular shift"}
                </small>
                <button
                  className="text-button"
                  disabled={locked(date)}
                  onClick={() => onEdit(s)}
                >
                  Edit this day
                </button>
              </div>
            ))}
            {!dayShifts.length && <p className="muted">No shift</p>}
            {absences
              .filter((a) => a.work_date === date)
              .map((a, i) => (
                <p className="calendar-absence" key={i}>
                  Approved absence · {a.paid ? "paid leave policy" : "unpaid"}
                </p>
              ))}
            {coverage
              .filter((c) => c.work_date === date)
              .map((c, i) => (
                <p className="calendar-coverage" key={i}>
                  Coverage {clock(c.start_at).slice(0, 5)}–
                  {clock(c.end_at).slice(0, 5)} · {c.status}
                </p>
              ))}
            {!!daySessions.length && (
              <small>
                Recorded:{" "}
                {hours(
                  daySessions.reduce(
                    (n, s) =>
                      n + (s.check_out === null ? 0 : s.check_out - s.check_in),
                    0,
                  ),
                )}
                {daySessions.some((s) => s.check_out === null)
                  ? " · session open"
                  : ""}
              </small>
            )}
            {locked(date) && <small>Finalized month · reopen to correct</small>}
          </article>
        );
      })}
    </section>
  );
}
