import { selectionFor } from "./navigation";
import {
  ScheduleCalendar,
  type CalendarAbsence,
  type CalendarCoverage,
} from "./schedule-calendar";
import { calculateAttendance, type Session } from "../shared/attendance";
import { MoreOptions } from "./more-options";
import { EmployeeVisibility } from "./employee-visibility";
import { useState } from "react";
import { localDate } from "../shared/domain";
import { dayStart, type Shift } from "../shared/attendance";
import { api } from "./api";
import { t } from "./text";
import {
  Form,
  Field,
  PersonSelect,
  ErrorNotice,
  useResource,
  clock,
  hours,
  type Person,
  day,
} from "./ui";
const minute = (f: FormData, key: string) => {
  const [h, m] = String(f.get(key)).split(":").map(Number);
  return h * 60 + m;
};
type WeeklyRule = {
  id: string;
  weekday: number;
  effective_date: string;
  start_minute: number;
  end_minute: number;
  active: number;
  second_start_minute: number | null;
  second_end_minute: number | null;
};
const minuteTime = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const secondShift = (f: FormData) => ({
  secondStartMinute: f.has("secondEnabled") ? minute(f, "secondStart") : null,
  secondEndMinute: f.has("secondEnabled") ? minute(f, "secondEnd") : null,
});
function SecondShiftFields({ start = null, end = null }: { start?: number | null; end?: number | null }) {
  const [enabled, setEnabled] = useState(start !== null);
  return <>
    <label className="check-field">
      <input type="checkbox" name="secondEnabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      Add a second shift on the same day
    </label>
    {enabled && <>
      <label>Second shift start<input name="secondStart" type="time" required defaultValue={minuteTime(start ?? 14 * 60)} /></label>
      <label>Second shift end<input name="secondEnd" type="time" required defaultValue={minuteTime(end ?? 18 * 60)} /></label>
      <p className="muted">The second shift must start after the first ends. Time between shifts is unpaid.</p>
    </>}
  </>;
}
export function ScheduleManager() {
  const { data: people, error } = useResource<{ employees: Person[] }>(
      "/attendance/people",
    ),
    [showDisabled, setShowDisabled] = useState(
      !!selectionFor("schedules")?.employeeId,
    ),
    [employeeId, setEmployee] = useState(
      selectionFor("schedules")?.employeeId ?? "",
    ),
    [from, setFrom] = useState(selectionFor("schedules")?.date ?? localDate()),
    [mode, setMode] = useState("weekly"),
    [revision, setRevision] = useState(0);
  const peopleField = (
    <PersonSelect
      people={(people?.employees ?? []).filter(
        (p) => showDisabled || !!p.active,
      )}
      value={employeeId}
      onChange={setEmployee}
    />
  );
  return (
    <div className="attendance-stack">
      <ErrorNotice error={error} />
      <section className="panel attendance-panel">
        <h2>{t("viewSchedule")}</h2>
        <div className="filter-bar">
          <MoreOptions active={showDisabled}>
            <EmployeeVisibility
              showDisabled={showDisabled}
              onChange={(show) => {
                setShowDisabled(show);
                if (
                  !show &&
                  !people?.employees.find((p) => p.id === employeeId)?.active
                )
                  setEmployee("");
              }}
              disabledCount={
                people?.employees.filter((p) => !p.active).length ?? 0
              }
            />
          </MoreOptions>

          {peopleField}
          <button
            className="secondary compact"
            onClick={() =>
              setFrom(
                localDate(Date.parse(from + "T12:00:00+05:00") - 7 * 86400000),
              )
            }
          >
            Previous week
          </button>
          <button
            className="secondary compact"
            onClick={() =>
              setFrom(
                localDate(Date.parse(from + "T12:00:00+05:00") + 7 * 86400000),
              )
            }
          >
            Next week
          </button>
          <label>
            {t("date")}
            <input
              type="date"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
          </label>
        </div>
        {!employeeId && (
          <TeamWeek
            key={from + revision}
            from={from}
            showDisabled={showDisabled}
            onPick={setEmployee}
          />
        )}
        {employeeId && (
          <section className="employee-card" data-employee-id={employeeId}>
            <header className="employee-card-heading">
              <h3>
                {people?.employees.find((p) => p.id === employeeId)?.full_name}
              </h3>
            </header>
            <ScheduleView
              key={employeeId + from + revision}
              employeeId={employeeId}
              date={from}
            />
          </section>
        )}
      </section>
      <details className="panel attendance-panel request-composer schedule-composer">
        <summary>Add shift</summary>
        <details className="inline-help">
          <summary>Schedule rules</summary>
          <p>{t("scheduleHelp")}</p>
        </details>
        <div className="attendance-toolbar">
          <label>
            {t("scheduleType")}
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {["weekly", "override", "extra", "overtime"].map((m) => (
                <option value={m} key={m}>
                  {t(m as "weekly" | "override" | "extra" | "overtime")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Form
          key={mode}
          path={
            mode === "overtime" ? "/attendance/overtime" : `/schedules/${mode}`
          }
          build={(f) => {
            const date = String(f.get("date")),
              startMinute = minute(f, "start"),
              endMinute = minute(f, "end"),
              base = {
                employeeId: String(f.get("employeeId")),
                reason: String(f.get("reason")),
              };
            if (mode === "weekly")
              return {
                ...base,
                ...secondShift(f),
                startMinute,
                endMinute,
                weekday: Number(f.get("weekday")),
                effectiveDate: date,
                active: f.get("enabled") === "on",
              };
            if (mode === "override")
              return {
                ...base,
                ...secondShift(f),
                date,
                startMinute,
                endMinute,
                cancelled: f.get("cancelled") === "on",
              };
            if (mode === "extra")
              return {
                ...base,
                date,
                startMinute,
                endMinute,
                approved: f.get("approved") === "on",
              };
            return {
              ...base,
              date,
              start: dayStart(date) + startMinute * 60,
              end: dayStart(date) + endMinute * 60,
            };
          }}
          onSaved={() => setRevision((v) => v + 1)}
        >
          {peopleField}
          <Field
            label={mode === "weekly" ? "effectiveDate" : "date"}
            name="date"
            type="date"
            value={localDate()}
          />
          {mode === "weekly" && (
            <>
              <label>
                {t("weekday")}
                <select name="weekday">
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((d, i) => (
                    <option value={i} key={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-field">
                <input name="enabled" type="checkbox" defaultChecked />
                {t("scheduledDay")}
              </label>
            </>
          )}
          <Field label="startTime" name="start" type="time" value="08:00" />
          <Field label="endTime" name="end" type="time" value="13:00" />
          {(mode === "weekly" || mode === "override") && <SecondShiftFields />}
          {mode === "override" && (
            <label className="check-field">
              <input name="cancelled" type="checkbox" />
              Cancel this day's regular shifts
            </label>
          )}
          {mode === "extra" && (
            <label className="check-field">
              <input name="approved" type="checkbox" />
              {t("approveExtra")}
            </label>
          )}
          {mode === "overtime" && <p>{t("overtimeHelp")}</p>}
          <Field label="reason" name="reason" />
        </Form>
      </details>
    </div>
  );
}
// Read-only overview of everyone's week; choosing a name opens the editable view.
function TeamWeek({
  from,
  showDisabled,
  onPick,
}: {
  from: string;
  showDisabled: boolean;
  onPick: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) =>
      localDate(Date.parse(from + "T12:00:00+05:00") + i * 86400000),
    ),
    { data, error, loading } = useResource<{
      people: { id: string; full_name: string; active: number }[];
      shifts: (Shift & { employee_id: string })[];
    }>(`/schedules/team?from=${days[0]}&to=${days[6]}`);
  const people = (data?.people ?? []).filter((p) => showDisabled || !!p.active);
  return (
    <div className="team-week">
      <ErrorNotice error={error} />
      {!data && <p>{loading ? t("loading") : ""}</p>}
      {data && !people.length && <p>{t("emptyEmployees")}</p>}
      {data && !!people.length && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("employee")}</th>
                {days.map((d) => (
                  <th key={d}>
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "UTC",
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    }).format(Date.parse(d + "T00:00:00Z"))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <button className="text-button" onClick={() => onPick(p.id)}>
                      {p.full_name}
                    </button>
                  </th>
                  {days.map((d) => {
                    const shifts = data.shifts.filter(
                      (s) => s.employee_id === p.id && s.work_date === d,
                    );
                    return (
                      <td key={d}>
                        {shifts.length
                          ? shifts.map((s) => (
                              <span
                                key={s.id}
                                className={`team-shift ${s.status}`}
                              >
                                {clock(s.start_at)}–{clock(s.end_at)}
                              </span>
                            ))
                          : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{t("teamWeekHelp")}</p>
    </div>
  );
}
function ScheduleView({
  employeeId,
  date,
}: {
  employeeId: string;
  date: string;
}) {
  const to = localDate(Date.parse(date + "T00:00:00+05:00") + 6 * 86400000),
    { data, error, loading, reload } = useResource<{
      revision: number;
      shifts: Shift[];
      weekly: WeeklyRule[];
      absences: CalendarAbsence[];
      coverage: CalendarCoverage[];
      sessions: (Session & { work_date: string })[];
      locks: { from_date: string; to_date: string }[];
      corrections: {
        id: string;
        work_date: string;
        before_json: string;
        after_json: string;
        actor_name: string;
        reason: string;
      }[];
    }>(
      `/schedules?employeeId=${encodeURIComponent(employeeId)}&from=${date}&to=${to}`,
    );
  const [editing, setEditing] = useState<
    { kind: "weekly"; row: WeeklyRule } | { kind: "shift"; row: Shift } | null
  >(null);
  const [proposed, setProposed] = useState<{
    start: number;
    end: number;
    cancelled: boolean;
    approved: boolean;
  } | null>(null);
  const locked = (date: string) =>
    !!data?.locks.some((l) => date >= l.from_date && date <= l.to_date);
  const editShift = (row: Shift) => {
    setEditing({ kind: "shift", row });
    setProposed(null);
  };
  const preview =
    editing?.kind === "shift" && data
      ? (() => {
          const row = editing.row;
          const sessions = data.sessions.filter(
            (s) => s.work_date === row.work_date,
          );
          const shifts = data.shifts.filter(
            (s) => s.work_date === row.work_date,
          );
          const before = calculateAttendance(sessions, shifts);
          const changed = proposed
            ? {
                ...row,
                start_at: dayStart(row.work_date) + proposed.start * 60,
                end_at: dayStart(row.work_date) + proposed.end * 60,
                status: proposed.cancelled
                  ? ("cancelled" as const)
                  : ("scheduled" as const),
                overtime_approved: proposed.approved ? 1 : 0,
              }
            : row;
          const after = calculateAttendance(
            sessions,
            shifts.map((s) => (s.id === row.id ? changed : s)),
          );
          return { before, after };
        })()
      : null;
  const latestWeekly =
    data?.weekly.filter(
      (w, index, all) =>
        all.findIndex((v) => v.weekday === w.weekday) === index,
    ) ?? [];
  const weekdayLabel = (weekday: number) =>
    new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 4 + weekday)),
    );
  return (
    <>
      <ErrorNotice error={error} />
      {loading && <p>{t("loading")}</p>}
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={async () => {
          setEditing(null);
          await reload();
        }}
      >
        {t("refresh")}
      </button>
      {data && (
        <ScheduleCalendar
          from={date}
          to={to}
          shifts={data.shifts}
          absences={data.absences}
          coverage={data.coverage}
          sessions={data.sessions}
          locked={locked}
          onEdit={editShift}
        />
      )}
      <details className="review-section">
        <summary>Shift list</summary>
        {data?.shifts.map((s) => (
          <div className="shift-row" key={s.id}>
            <strong>{day(s.work_date)}</strong>
            <span>
              {clock(s.start_at).slice(0, 5)} — {clock(s.end_at).slice(0, 5)}
            </span>
            <span
              className={`badge ${s.status === "cancelled" ? "status-neutral" : "status-good"}`}
            >
              {s.status === "cancelled"
                ? t("cancelled")
                : s.kind === "extra"
                  ? t("extraShift")
                  : t("regularShift")}
            </span>
            <button
              type="button"
              className="secondary compact"
              disabled={locked(s.work_date)}
              onClick={() => editShift(s)}
            >
              {t("editThisDay")}
            </button>
          </div>
        ))}
        {!!data?.corrections.length && (
          <details className="review-section">
            <summary>Schedule correction history</summary>
            {data.corrections.map((h) => {
              const before = JSON.parse(h.before_json) as Shift,
                after = JSON.parse(h.after_json) as Shift;
              return (
                <p key={h.id}>
                  {day(h.work_date)} · {clock(before.start_at).slice(0, 5)}–
                  {clock(before.end_at).slice(0, 5)} ({before.status}) →{" "}
                  {clock(after.start_at).slice(0, 5)}–
                  {clock(after.end_at).slice(0, 5)} ({after.status}) ·{" "}
                  {h.actor_name}
                  {h.reason ? " · " + h.reason : ""}
                </p>
              );
            })}
          </details>
        )}
        {data && !data.shifts.length && <p>{t("noSchedule")}</p>}
      </details>
      {!!latestWeekly.length && (
        <section className="review-section">
          <h3>{t("existingWeeklySchedule")}</h3>
          <p>{t("weeklyEditHelp")}</p>
          {latestWeekly.map((w) => (
            <div className="shift-row" key={w.id}>
              <strong>{weekdayLabel(w.weekday)}</strong>
              <span>
                {minuteTime(w.start_minute)} — {minuteTime(w.end_minute)}
                {w.second_start_minute !== null && w.second_end_minute !== null &&
                  <> / {minuteTime(w.second_start_minute)} — {minuteTime(w.second_end_minute)}</>}
              </span>
              <span>
                {day(w.effective_date)} ·{" "}
                {w.active ? t("scheduledDay") : t("cancelled")}
              </span>
              <button
                type="button"
                className="secondary compact"
                onClick={() => setEditing({ kind: "weekly", row: w })}
              >
                {t("editWeeklySchedule")}
              </button>
            </div>
          ))}
        </section>
      )}
      {editing && data && (
        <section
          className="panel attendance-panel"
          onChange={(event) => {
            if (editing.kind !== "shift") return;
            const form = (event.target as HTMLElement).closest("form");
            if (!form) return;
            const values = new FormData(form);
            setProposed({
              start: minute(values, "start"),
              end: minute(values, "end"),
              cancelled: values.has("cancelled"),
              approved: values.has("approved"),
            });
          }}
        >
          <div className="attendance-toolbar">
            <h3>
              {t(
                editing.kind === "weekly"
                  ? "editWeeklySchedule"
                  : "editThisDay",
              )}
            </h3>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </button>
          </div>
          <p>
            {editing.kind === "weekly"
              ? weekdayLabel(editing.row.weekday)
              : editing.row.work_date}
          </p>
          <p>{t("scheduleEditHelp")}</p>
          {preview && (
            <div className="notice" role="status">
              Credited regular time:{" "}
              <strong>
                {hours(preview.before.regularSeconds)} →{" "}
                {hours(preview.after.regularSeconds)}
              </strong>
              . Scheduled extra-shift credit:{" "}
              {hours(preview.before.overtimeSeconds)} →{" "}
              {hours(preview.after.overtimeSeconds)}. This preview uses recorded
              sessions and approved extra shifts. Separate overtime approvals,
              rates and fines are recalculated in Payroll.
            </div>
          )}
          <Form
            key={editing.kind + editing.row.id}
            path={
              editing.kind === "weekly"
                ? `/schedules/weekly/${encodeURIComponent(editing.row.id)}/edit`
                : `/schedules/shifts/${encodeURIComponent(editing.row.id)}/edit`
            }
            build={(f) => ({
              startMinute: minute(f, "start"),
              endMinute: minute(f, "end"),
              revision: data.revision,
              reason: String(f.get("reason")),
              ...(editing.kind === "weekly"
                ? {
                    ...secondShift(f),
                    effectiveDate: String(f.get("date")),
                    active: f.has("enabled"),
                  }
                : {
                    cancelled: f.has("cancelled"),
                    approved: f.has("approved"),
                  }),
            })}
            onSaved={async () => {
              await reload();
              setEditing(null);
            }}
          >
            {editing.kind === "weekly" && (
              <>
                <Field
                  label="effectiveDate"
                  name="date"
                  type="date"
                  value={
                    editing.row.effective_date < localDate()
                      ? localDate()
                      : editing.row.effective_date
                  }
                />
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={!!editing.row.active}
                  />
                  {t("scheduledDay")}
                </label>
              </>
            )}
            <Field
              label="startTime"
              name="start"
              type="time"
              value={
                editing.kind === "weekly"
                  ? minuteTime(editing.row.start_minute)
                  : clock(editing.row.start_at).slice(0, 5)
              }
            />
            <Field
              label="endTime"
              name="end"
              type="time"
              value={
                editing.kind === "weekly"
                  ? minuteTime(editing.row.end_minute)
                  : clock(editing.row.end_at).slice(0, 5)
              }
            />
            {editing.kind === "weekly" && <SecondShiftFields start={editing.row.second_start_minute} end={editing.row.second_end_minute} />}
            {editing.kind === "shift" && (
              <>
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="cancelled"
                    defaultChecked={editing.row.status === "cancelled"}
                  />
                  {t("cancelShift")}
                </label>
                {editing.row.kind === "extra" && (
                  <label className="check-field">
                    <input
                      type="checkbox"
                      name="approved"
                      defaultChecked={!!editing.row.overtime_approved}
                    />
                    {t("approveExtra")}
                  </label>
                )}
              </>
            )}
            <Field label="reason" name="reason" />
          </Form>
        </section>
      )}
      {!!data?.weekly.length && (
        <details>
          <summary>{t("weeklyHistory")}</summary>
          {data.weekly.map((w) => (
            <p key={w.id}>
              {new Intl.DateTimeFormat("en", {
                weekday: "long",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(2026, 0, 4 + w.weekday)))}{" "}
              · {String(Math.floor(w.start_minute / 60)).padStart(2, "0")}:
              {String(w.start_minute % 60).padStart(2, "0")} —{" "}
              {String(Math.floor(w.end_minute / 60)).padStart(2, "0")}:
              {String(w.end_minute % 60).padStart(2, "0")}
              {w.second_start_minute !== null && w.second_end_minute !== null &&
                <> / {minuteTime(w.second_start_minute)} — {minuteTime(w.second_end_minute)}</>}
              {" "}· {day(w.effective_date)}{" "}
              · {w.active ? t("scheduledDay") : t("cancelled")}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
type Tablet = {
  id: string;
  name: string;
  pairing_expires_at: number | null;
  credential_expires_at: number | null;
  paired: boolean;
  revoked_at: number | null;
};
export function TabletManager() {
  const { data, error, reload } = useResource<{ tablets: Tablet[] }>(
      "/tablets",
    ),
    [pair, setPair] = useState<{ code: string; expires: number } | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setError] = useState(""),
    [revoke, setRevoke] = useState<Tablet | null>(null),
    [tick, setTick] = useState(0);
  // Pairing data remains in memory; a failed registration can be safely retried with the same key.
  const [draft, setDraft] = useState<{
    code: string;
    key: string;
    name: string;
  } | null>(null);
  const generate = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  async function register() {
    if (busy) return;
    setBusy(true);
    setError("");
    const op =
      draft && draft.name === name
        ? draft
        : { code: generate(), key: crypto.randomUUID(), name };
    setDraft(op);
    try {
      await api(
        "/tablets",
        "POST",
        { name: op.name, pairingCode: op.code },
        op.key,
      );
      setPair({ code: op.code, expires: Date.now() + 300000 });
      setDraft(null);
      setName("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useExpiryTick(setTick);
  void tick;
  return (
    <div className="attendance-stack">
      <ErrorNotice error={error || actionError} />
      <section className="panel attendance-panel">
        <h2>{t("registerTablet")}</h2>
        <p>{t("tabletHelp")}</p>
        <form
          className="attendance-form"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <label>
            {t("tabletName")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <button className="primary" disabled={busy}>
            {t("registerTablet")}
          </button>
        </form>
        {pair && pair.expires > Date.now() && (
          <div className="pairing-code">
            <p>{t("pairingHelp")}</p>
            <code>{pair.code}</code>
            <small>
              {Math.max(0, Math.ceil((pair.expires - Date.now()) / 1000))}s ·{" "}
              {t("pairingExpires")}
            </small>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pair.code)
                  .catch((e) => setError((e as Error).message))
              }
            >
              {t("copyCode")}
            </button>
          </div>
        )}
        {pair && pair.expires <= Date.now() && <p>{t("pairingExpired")}</p>}
        <a
          className="text-button"
          href="/reception/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("openReception")}
        </a>
      </section>
      <section className="panel attendance-panel">
        <h2>{t("registeredDisplays")}</h2>
        {data?.tablets.map((v) => (
          <div className="shift-row" key={v.id}>
            <strong>{v.name}</strong>
            <span>
              {v.revoked_at
                ? t("revoked")
                : v.paired &&
                    (v.credential_expires_at === null ||
                      v.credential_expires_at * 1000 > Date.now())
                  ? t("paired")
                  : v.pairing_expires_at &&
                      v.pairing_expires_at * 1000 > Date.now()
                    ? t("awaitingPair")
                    : t("expired")}
            </span>
            {!v.revoked_at && (
              <button
                className="secondary compact"
                onClick={() => setRevoke(v)}
              >
                {t("revoke")}
              </button>
            )}
          </div>
        ))}
        {!data?.tablets.length && <p>{t("noDisplays")}</p>}
      </section>
      {revoke && (
        <section className="panel attendance-panel">
          <div className="attendance-toolbar">
            <h2>
              {t("revoke")} · {revoke.name}
            </h2>
            <button className="secondary" onClick={() => setRevoke(null)}>
              {t("cancel")}
            </button>
          </div>
          <Form
            key={revoke.id}
            path={`/tablets/${revoke.id}/revoke`}
            build={(f) => ({ reason: String(f.get("reason")) })}
            onSaved={async () => {
              setRevoke(null);
              await reload();
            }}
          >
            <Field label="reason" name="reason" />
          </Form>
        </section>
      )}
    </div>
  );
}
import { useEffect } from "react";
function useExpiryTick(set: (fn: (n: number) => number) => void) {
  useEffect(() => {
    const timer = setInterval(() => set((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);
}
