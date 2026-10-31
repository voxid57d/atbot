import { EmployeeFocus } from "./employee-focus";
import { selectionFor } from "./navigation";
import { MonthPicker, monthName } from "./month-picker";
import { MoreOptions } from "./more-options";
import { EmployeeVisibility } from "./employee-visibility";
import { statusClass } from "./status";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import { EmployeeRequests, type RequestKind } from "./requests-ui";
import { UniformToday } from "./discipline-ui";
import { t, type TextKey } from "./text";
import { localDate, formatMoney } from "../shared/domain";
import type { Session, Shift } from "../shared/attendance";
import { checkoutState, type CheckoutTiming } from "../shared/checkout";
import { dayStart } from "../shared/attendance";
import { clock, hours, ShiftAttendanceDetails, ErrorNotice, useResource, Form, Field, type Person, type ShiftAttendance, day } from "./ui";
export { clock, hours, ShiftAttendanceDetails, ErrorNotice, useResource, Form, Field, PersonSelect, type Person, type ShiftAttendance } from "./ui";
export type RecordSession = Session & {
  id: string;
  work_date: string;
  checkout_source?: string;
  checkout_reason?: string;
  automatically_closed?: number;
  manual?: number;
  corrected?: number;
};
type Day = {
  shiftAttendance?: ShiftAttendance[];
  date: string;
  paidSeconds: number;
  shifts: Shift[];
  sessions: RecordSession[];
  actualSeconds: number;
  regularSeconds: number;
  overtimeSeconds: number;
  pendingOvertimeSeconds: number;
  lateMinutes: number;
  earlyDepartureSeconds: number;
  estimatedGross: number;
};
type Mine = {
  today: string;
  serverTime: number;
  active: RecordSession | null;
  checkout: CheckoutTiming | null;
  period: { from: string; to: string };
  days: Day[];
  upcoming: Shift[];
  todayAttendance: { actualSeconds: number };
  absences: { work_date: string; status: string; paid: number }[];
  summary: {
    actualSeconds: number;
    regularSeconds: number;
    overtimeSeconds: number;
    estimatedGross: number;
    pending: boolean;
    paidSeconds: number;
  };
};
function Camera({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false,
      stop: () => void = () => {};
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserQRCodeReader(),
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: "environment" } },
            video.current!,
            (result) => {
              if (result) {
                onScan(result.getText());
                onClose();
              }
            },
          );
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch (e) {
        if (!cancelled) setError(`${t("cameraError")} ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("scanQR")}
      >
        <h2>{t("scanQR")}</h2>
        <video ref={video} className="scanner" muted playsInline />
        <ErrorNotice error={error} />
        <button className="secondary" autoFocus onClick={onClose}>
          {t("cancel")}
        </button>
      </section>
    </div>
  );
}
export function EmployeeAttendance() {
  const [periodDate, setPeriodDate] = useState(localDate());
  const [requestKind, setRequestKind] = useState<RequestKind>(null);
  const { data, error, loading, reload } = useResource<Mine>(
      `/attendance/mine?periodDate=${periodDate}`,
      30,
    ),
    [scan, setScan] = useState(false),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(""),
    [notice, setNotice] = useState(""),
    [tick, setTick] = useState(0),
    operation = useRef<{ path: string; input: unknown; key: string } | null>(
      null,
    ),
    inFlight = useRef(false),
    serverAnchor = useRef({ time: 0, monotonic: 0 });
  useEffect(() => {
    if (data)
      serverAnchor.current = {
        time: data.serverTime,
        monotonic: performance.now(),
      };
  }, [data]);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  async function send(path: string, input: unknown, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    if (!retry) operation.current = { path, input, key: crypto.randomUUID() };
    const op = operation.current!;
    try {
      await api(op.path, "POST", op.input, op.key);
      operation.current = null;
      setNotice(t("attendanceSaved"));
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  function beginScan() {
    const scanPath = data?.active
      ? "/attendance/check-out"
      : "/attendance/check-in";
    setActionError("");
    const webapp = window.Telegram?.WebApp;
    if (webapp?.showScanQrPopup && webapp.isVersionAtLeast?.("6.4")) {
      try {
        webapp.showScanQrPopup({ text: t("scanHint") }, (value) => {
          void send(scanPath, { qr: value });
          return true;
        });
      } catch {
        setScan(true);
      }
    } else setScan(true);
  }
  if (!data)
    return (
      <section className="panel attendance-panel">
        <ErrorNotice error={error} />
        <p>{loading ? t("loading") : t("noAttendance")}</p>
        <button className="secondary" onClick={() => void reload()}>
          {t("retry")}
        </button>
      </section>
    );
  const active = data.active,
    current =
      serverAnchor.current.time +
      (performance.now() - serverAnchor.current.monotonic) / 1000,
    elapsed = active
      ? Math.max(0, Math.min(18 * 3600, current - active.check_in))
      : 0,
    checkout = active && data.checkout ? checkoutState(data.checkout.expectedEnd, current) : "working",
    today = data.todayAttendance;
  void tick;
  return (
    <div className="attendance-stack">
      <ErrorNotice error={error || actionError} />
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {actionError && operation.current && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void send(operation.current!.path, operation.current!.input, true)
          }
        >
          {t("retryLast")}
        </button>
      )}
      <section className="panel attendance-panel today-schedule">
        <h2>Today's schedule</h2>
        {data.upcoming
          .filter((s) => s.work_date === data.today && s.status === "scheduled")
          .map((s) => (
            <p key={s.id}>
              <strong>
                {clock(s.start_at).slice(0, 5)}–{clock(s.end_at).slice(0, 5)}
              </strong>{" "}
              · {s.kind === "extra" ? "Extra shift" : "Regular shift"}
            </p>
          ))}
        {!data.upcoming.some(
          (s) => s.work_date === data.today && s.status === "scheduled",
        ) && (
          <p className="notice">
            No shift scheduled today. Recorded time needs administrator approval
            before it can contribute to salary.
          </p>
        )}
      </section>
      <section className={`attendance-hero ${active ? "working" : ""}`}>
        <div>
          <span className="eyebrow">
            {data.today} · {t("timezone")}
          </span>
          <h2>{active ? t("onShift") : t("readyForWork")}</h2>
          <p>
            {active
              ? `${t("checkedInAt")} ${clock(active.check_in)}`
              : t("scanHint")}
          </p>
          <strong className="elapsed">
            {active
              ? hours(elapsed)
              : today
                ? hours(today.actualSeconds)
                : "0h 0m"}
          </strong>
          <small>{active ? t("liveTime") : t("actualToday")}</small>
        </div>
        <button
          className="primary"
          disabled={busy || loading}
          onClick={() => beginScan()}
        >
          {busy
            ? t("saving")
            : active
              ? "Scan QR to check out"
              : "Scan QR to check in"}
        </button>
      </section>
      {active && checkout !== "working" && (
        <div className="notice" role="status">
          {checkout === "review" ? t("forgottenHelp") : checkout === "overdue"
            ? t("checkoutOverdueHelp") : t("checkoutReminderHelp")}
        </div>
      )}
      <UniformToday key={`${localDate()}:${active?.id ?? "closed"}`} />
      <section className="panel attendance-panel">
        <div className="attendance-toolbar">
          <h2>{t("upcomingShifts")}</h2>
          <button
            className="secondary compact"
            disabled={loading}
            onClick={() => void reload()}
          >
            {t("refresh")}
          </button>
        </div>
        {data.upcoming.filter((s) => s.status === "scheduled").length ? (
          data.upcoming
            .filter((s) => s.status === "scheduled")
            .map((s) => (
              <div className="shift-row" key={s.id}>
                <strong>{day(s.work_date)}</strong>
                <span>
                  {clock(s.start_at).slice(0, 5)} —{" "}
                  {clock(s.end_at).slice(0, 5)}
                </span>
                <span className="badge">
                  {s.kind === "extra" ? t("extraShift") : t("regularShift")}
                </span>
              </div>
            ))
        ) : (
          <p>{t("noSchedule")}</p>
        )}
      </section>
      <details className="panel attendance-panel employee-history">
        <summary>Monthly attendance and estimates</summary>
        <MonthPicker
          value={periodDate}
          onChange={setPeriodDate}
          label="Attendance month"
        />
        <h3>{monthName(data.period.from)}</h3>

        <div className="attendance-metrics">
          {[
            [t("actualTime"), hours(data.summary.actualSeconds)],
            ["Paid hours", hours(data.summary.paidSeconds)],
            [t("paidRegular"), hours(data.summary.regularSeconds)],
            [t("approvedOvertime"), hours(data.summary.overtimeSeconds)],
            [t("grossEstimate"), formatMoney(data.summary.estimatedGross)],
          ].map(([label, value]) => (
            <section className="panel attendance-panel" key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </section>
          ))}
        </div>
        <p>
          Only completed hours count toward salary, after combining each day's
          credited regular time and approved overtime. Time within 5 minutes of
          the next hour counts as that hour; other leftover minutes do not carry
          forward. {day(data.period.from)} — {day(data.period.to)} ·{" "}
          {t("estimateHelp")} {data.summary.pending && t("pendingHelp")}
        </p>
        <section className="panel">
          <div className="attendance-panel">
            <h2>{t("periodAttendance")}</h2>
          </div>
          <div className="table-scroll attendance-history-desktop">
            <table>
              <thead>
                <tr>
                  {[
                    "date",
                    "sessions",
                    "actualTime",
                    "paidRegular",
                    "approvedOvertime",
                    "lateLabel",
                    "grossEstimate",
                  ].map((k) => (
                    <th key={k}>{t(k as TextKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.days
                  .filter((d) => d.sessions.length)
                  .map((d) => (
                    <tr key={d.date}>
                      <td>{day(d.date)}</td>
                      <td>
                        {d.sessions.map((s) => (
                          <div key={s.id}>
                            {clock(s.check_in)} —{" "}
                            {s.check_out === null
                              ? t("openSession")
                              : clock(s.check_out)}
                            {!!(s.manual || s.corrected) && (
                              <small>{t("correctedAttendance")}</small>
                            )}
                            {s.checkout_source === "admin" && (
                              <small>
                                {t("adminClosed")}: {s.checkout_reason}
                              </small>
                            )}
                            {!!s.automatically_closed && <small>Automatically checked out at 23:00 Tashkent time</small>}
                          </div>
                        ))}
                      </td>
                      <td>{hours(d.actualSeconds)}</td>
                      <td>{hours(d.regularSeconds)}</td>
                      <td>
                        {hours(d.overtimeSeconds)}
                        {d.pendingOvertimeSeconds > 0 && (
                          <small>
                            {hours(d.pendingOvertimeSeconds)}{" "}
                            {t("pendingOvertime")}
                          </small>
                        )}
                      </td>
                      <td>{d.lateMinutes}m<ShiftAttendanceDetails rows={d.shiftAttendance} /></td>
                      <td>
                        {formatMoney(d.estimatedGross)}
                        <small>{d.paidSeconds / 3600} paid hours</small>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="attendance-history-mobile">
            {data.days
              .filter((d) => d.sessions.length)
              .map((d) => (
                <details className="history-day" key={d.date}>
                  <summary>
                    <span>
                      <strong>{day(d.date)}</strong>
                      <small>
                        {hours(d.regularSeconds)} {t("paidRegular")}
                      </small>
                    </span>
                    <strong>{formatMoney(d.estimatedGross)}</strong>
                  </summary>
                  <dl className="history-metrics">
                    {[
                      [t("actualTime"), hours(d.actualSeconds)],
                      ["Paid hours", hours(d.paidSeconds)],
                      [t("paidRegular"), hours(d.regularSeconds)],
                      [t("approvedOvertime"), hours(d.overtimeSeconds)],
                      [t("lateLabel"), `${d.lateMinutes}m`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {d.pendingOvertimeSeconds > 0 && (
                    <p>
                      {hours(d.pendingOvertimeSeconds)} {t("pendingOvertime")}
                    </p>
                  )}
                  {d.sessions.map((s) => (
                    <p className="history-session" key={s.id}>
                      {clock(s.check_in)} -{" "}
                      {s.check_out === null
                        ? t("openSession")
                        : clock(s.check_out)}{" "}
                      {!!(s.manual || s.corrected) && (
                        <small>{t("correctedAttendance")}</small>
                      )}
                      {s.checkout_source === "admin" && (
                        <small>
                          {t("adminClosed")}: {s.checkout_reason}
                        </small>
                      )}
                      {!!s.automatically_closed && <small>Automatically checked out at 23:00 Tashkent time</small>}
                    </p>
                  ))}
                </details>
              ))}
          </div>
          {!data.days.some((d) => d.sessions.length) && (
            <p className="attendance-panel">{t("noAttendance")}</p>
          )}
        </section>
      </details>
      {scan && (
        <Camera
          onScan={(qr) =>
            void send(
              active ? "/attendance/check-out" : "/attendance/check-in",
              { qr },
            )
          }
          onClose={() => setScan(false)}
        />
      )}
      {data.absences.some((a) => a.work_date === data.today) && (
        <div className="notice">
          {t("absenceToday")}:{" "}
          {data.absences.find((a) => a.work_date === data.today)!.status}
        </div>
      )}
      <EmployeeRequests
        activeKind={requestKind}
        onKindChange={setRequestKind}
      />
    </div>
  );
}
type LivePerson = Person & {
  shiftAttendance?: ShiftAttendance[];
  status: string;
  forgotten: boolean;
  checkout: CheckoutTiming | null;
  activeSession: RecordSession | null;
  actualSeconds: number;
  regularSeconds: number;
  lateMinutes: number;
  sessions: RecordSession[];
  shifts: Shift[];
};
export function AdminAttendance() {
  const [date, setDate] = useState(
      selectionFor("attendance")?.date ?? localDate(),
    ),
    [showDisabled, setShowDisabled] = useState(
      !!selectionFor("attendance")?.employeeId,
    ),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<LivePerson | null>(null),
    [manual, setManual] = useState<{
      person: LivePerson;
      workDate: string;
    } | null>(null),
    [correction, setCorrection] = useState<{
      person: LivePerson;
      session: RecordSession;
    } | null>(null),
    { data, error, loading, reload } = useResource<{
      employees: LivePerson[];
      date: string;
    }>(`/attendance/live?date=${date}`, 30);
  useEffect(() => {
    const focus = selectionFor("attendance");
    if (!data || !focus?.employeeId) return;
    const person = data.employees.find((p) => p.id === focus.employeeId);
    if (!person) return;
    if (focus.taskKind === "invalid_session") {
      const session = person.sessions.find(
        (s) =>
          s.check_out !== null &&
          (s.check_out > dayStart(s.work_date) + 86400 ||
            s.check_out - s.check_in > 18 * 3600),
      );
      if (session && !session.manual) setCorrection({ person, session });
    } else if (focus.taskKind === "open_attendance" && person.activeSession)
      setSelected(person);
  }, [data?.date]);
  useEffect(() => {
    if (correction)
      document
        .getElementById("checkout-correction")
        ?.scrollIntoView({ block: "center" });
  }, [correction]);
  useEffect(() => {
    setManual(null);
    setSelected(null);
    setCorrection(null);
  }, [date]);
  useEffect(() => {
    if (manual)
      document
        .getElementById("manual-attendance")
        ?.scrollIntoView({ block: "center" });
  }, [manual]);
  const rows =
    data?.employees.filter(
      (p) =>
        (showDisabled || !!p.active) &&
        (!selectionFor("attendance")?.employeeId ||
          p.id === selectionFor("attendance")?.employeeId) &&
        (filter === "all" ||
          (filter === "forgotten" && p.forgotten) ||
          p.status === filter),
    ) ?? [];
  return (
    <div className="attendance-stack">
      <EmployeeFocus
        page="attendance"
        name={
          data?.employees.find(
            (p) => p.id === selectionFor("attendance")?.employeeId,
          )?.full_name ?? "selected employee"
        }
      />
      <ErrorNotice error={error} />
      <section className="panel">
        <div className="attendance-toolbar attendance-panel">
          <label>
            {t("date")}
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
          <label>
            {t("status")}
            <select
              aria-label={t("status")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {[
                "all",
                "Working",
                "Finished",
                "Not checked in",
                "Approved absence",
                "Absence pending",
                "Unscheduled",
                ...(showDisabled ? ["Inactive"] : []),
                "forgotten",
              ].map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <MoreOptions active={showDisabled}>
            <EmployeeVisibility
              showDisabled={showDisabled}
              onChange={(show) => {
                setShowDisabled(show);
                if (!show && filter === "Inactive") setFilter("all");
                if (!show && selected && !selected.active) setSelected(null);
              }}
              disabledCount={
                data?.employees.filter((p) => !p.active).length ?? 0
              }
            />
            <button
              className="secondary"
              disabled={loading}
              onClick={() => void reload()}
            >
              {t("refresh")}
            </button>
          </MoreOptions>
        </div>
        <div className="employee-card-grid live-attendance-cards">
          {rows.map((p) => (
            <article
              className="live-person employee-card"
              data-employee-id={p.id}
              key={p.id}
            >
              <div className="request-heading">
                <strong>{p.full_name}</strong>
                <span className={`badge ${statusClass(p.status)}`}>
                  {statusLabel(p.status)}
                </span>
              </div>
              {p.forgotten && <p className="danger-text">{t("forgotten")}</p>}
              {p.checkout?.state === "overdue" && <p className="muted">{t("checkoutOverdue")}</p>}
              <div className="live-sessions">
                {p.sessions.length ? (
                  p.sessions.map((s) => (
                    <p key={s.id}>
                      {clock(s.check_in)} —{" "}
                      {s.check_out === null ? (
                        t("openSession")
                      ) : (
                        <>
                          {localDate(s.check_out * 1000) !== localDate(s.check_in * 1000) && `${day(localDate(s.check_out * 1000))} `}{clock(s.check_out)}
                          {!s.manual && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelected(null);
                                setManual(null);
                                setCorrection({ person: p, session: s });
                              }}
                            >
                              Correct checkout
                            </button>
                          )}
                          {!!s.manual && (
                            <span className="badge">Manually recorded</span>
                          )}
                          {(s.check_out > dayStart(s.work_date) + 86400 ||
                            s.check_out - s.check_in > 18 * 3600) && (
                            <span className="danger-text">
                              Checkout needs correction: it exceeds this workday
                              or the 18-hour limit.
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  ))
                ) : (
                  <p className="muted">{t("notCheckedIn")}</p>
                )}
              </div>
              <details className="live-person-details">
                <summary>Attendance details</summary>
                <dl className="history-metrics">
                  <div>
                    <dt>{t("actualTime")}</dt>
                    <dd>{hours(p.actualSeconds)}</dd>
                  </div>
                  <div>
                    <dt>{t("paidRegular")}</dt>
                    <dd>{hours(p.regularSeconds)}</dd>
                  </div>
                  <div>
                    <dt>{t("lateLabel")}</dt>
                    <dd>{p.lateMinutes}m</dd>
                  </div>
                </dl>
                <ShiftAttendanceDetails rows={p.shiftAttendance} />
                {p.shifts
                  .filter((s) => s.status === "scheduled")
                  .map((s) => (
                    <p key={s.id}>
                      {t("scheduled")}: {clock(s.start_at).slice(0, 5)} —{" "}
                      {clock(s.end_at).slice(0, 5)}
                    </p>
                  ))}
                {date <= localDate() && p.sessions.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(null);
                      setCorrection(null);
                      setManual({ person: p, workDate: date });
                    }}
                  >
                    Add another visit manually
                  </button>
                )}
              </details>
              {p.activeSession && (
                <button
                  className="secondary compact"
                  onClick={() => {
                    setManual(null);
                    setCorrection(null);
                    setSelected(p);
                  }}
                >
                  {t("closeSession")}
                </button>
              )}
              {/* Shown on the card only when nothing was recorded; otherwise it lives in the details. */}
              {date <= localDate() && !p.sessions.length && (
                <button
                  className="secondary compact"
                  onClick={() => {
                    setSelected(null);
                    setCorrection(null);
                    setManual({ person: p, workDate: date });
                  }}
                >
                  Add manual attendance
                </button>
              )}
            </article>
          ))}
        </div>
        {!rows.length && (
          <p className="attendance-panel">
            {loading ? t("loading") : t("noAttendance")}
          </p>
        )}
      </section>
      {correction && (
        <section id="checkout-correction" className="panel attendance-panel">
          <div className="attendance-toolbar">
            <h2>Correct checkout · {correction.person.full_name}</h2>
            <button className="secondary" onClick={() => setCorrection(null)}>
              Cancel
            </button>
          </div>
          <p>
            Workday: {day(correction.session.work_date)}. Recorded check-in:{" "}
            {clock(correction.session.check_in)}. Recorded checkout:{" "}
            {localDate(correction.session.check_out! * 1000)}{" "}
            {clock(correction.session.check_out!)}.
          </p>
          <p>
            Confirm when this employee actually left, then enter that departure
            time below (Tashkent time). The original record is preserved and
            salary figures are recalculated. The check-in stays unchanged.
          </p>
          <Form
            key={correction.session.id}
            path={`/attendance/${correction.session.id}/correct-checkout`}
            build={(f) => ({
              checkout: Math.floor(
                Date.parse(String(f.get("checkout")) + ":00+05:00") / 1000,
              ),
              expectedCheckIn: correction.session.check_in,
              expectedCheckout: correction.session.check_out,
              reason: String(f.get("reason") ?? ""),
            })}
            onSaved={async () => {
              setCorrection(null);
              await reload();
            }}
          >
            <Field label="checkoutTime" name="checkout" type="datetime-local" />
            <Field label="reason" name="reason" required={false} />
          </Form>
        </section>
      )}
      {manual && (
        <section id="manual-attendance" className="panel attendance-panel">
          <div className="attendance-toolbar">
            <h2>Add manual attendance · {manual.person.full_name}</h2>
            <button className="secondary" onClick={() => setManual(null)}>
              Cancel
            </button>
          </div>
          <p>
            Workday: {manual.workDate}. Enter when this employee actually
            arrived and left, in Tashkent time. This saves an approved manual
            record and recalculates salary. Work outside the regular schedule
            still needs overtime approval.
          </p>
          <Form
            key={`${manual.person.id}:${manual.workDate}`}
            path="/attendance/manual"
            build={(f) => ({
              employeeId: manual.person.id,
              date: manual.workDate,
              start: Math.floor(
                Date.parse(
                  `${manual.workDate}T${String(f.get("start"))}+05:00`,
                ) / 1000,
              ),
              end: Math.floor(
                Date.parse(`${manual.workDate}T${String(f.get("end"))}+05:00`) /
                  1000,
              ),
              reason: String(f.get("reason") ?? ""),
            })}
            onSaved={async () => {
              setManual(null);
              await reload();
            }}
          >
            <Field label="requestedCheckIn" name="start" type="time" />
            <Field label="requestedCheckOut" name="end" type="time" />
            <Field label="reason" name="reason" required={false} />
          </Form>
        </section>
      )}
      {selected && (
        <section className="panel attendance-panel">
          <div className="attendance-toolbar">
            <h2>
              {t("closeSession")} · {selected.full_name}
            </h2>
            <button className="secondary" onClick={() => setSelected(null)}>
              {t("cancel")}
            </button>
          </div>
          <p>{t("closeHelp")}</p>
          <Form
            key={selected.activeSession!.id}
            path={`/attendance/${selected.activeSession!.id}/close`}
            build={(f) => ({
              checkout: Math.floor(
                Date.parse(String(f.get("checkout")) + ":00+05:00") / 1000,
              ),
              reason: String(f.get("reason")),
            })}
            onSaved={async () => {
              setSelected(null);
              await reload();
            }}
          >
            <Field label="checkoutTime" name="checkout" type="datetime-local" />
            <Field label="reason" name="reason" />
          </Form>
        </section>
      )}
    </div>
  );
}
function statusLabel(status: string) {
  const keys: Record<string, TextKey> = {
    all: "allPeople",
    "Approved absence": "approvedAbsent",
    "Absence pending": "pending",
    Working: "onShift",
    Finished: "finished",
    "Not checked in": "notCheckedIn",
    Unscheduled: "unscheduled",
    Inactive: "inactive",
    forgotten: "forgotten",
  };
  return t(keys[status] ?? "status");
}
