import { EmployeeFocus } from "./employee-focus";
import { selectionFor } from "./navigation";
import { EmployeeCards } from "./employee-cards";
import { MoreOptions } from "./more-options";
import { statusClass } from "./status";
import { EmployeeVisibility } from "./employee-visibility";
import { useState } from "react";
import {
  Form,
  Field,
  ErrorNotice,
  useResource,
  clock,
  PersonSelect,
  day,
} from "./ui";
import { t } from "./text";
import { localDate } from "../shared/domain";
import { dayStart } from "../shared/attendance";
type RequestRow = {
  id: string;
  employee_id: string;
  kind: string;
  work_date: string;
  reason: string;
  payload_json: string;
  status: string;
  paid: number;
  decision_reason: string | null;
  full_name?: string;
};
type Coverage = {
  id: string;
  absence_id: string;
  employee_id: string;
  work_date: string;
  start_at: number;
  end_at: number;
  status: string;
  full_name?: string;
};
type Requests = { requests: RequestRow[]; coverage: Coverage[] };
type Person = { id: string; full_name: string; active: number | boolean };
const value = (f: FormData, n: string) => String(f.get(n) ?? "");
const time = (f: FormData, n: string) => {
  const [h, m, s = 0] = value(f, n).split(":").map(Number);
  return dayStart(value(f, "date")) + h * 3600 + m * 60 + s;
};
function Details({ row }: { row: RequestRow }) {
  const p = JSON.parse(row.payload_json) as {
    category?: string;
    type?: string;
    start?: number;
    end?: number;
    originalIn?: number;
    originalOut?: number | null;
    sessionId?: string;
    administratorCorrection?: boolean;
  };
  return (
    <>
      <div className="request-heading">
        <strong>{row.full_name ?? row.work_date}</strong>
        <span className={`badge ${statusClass(row.status)}`}>
          {row.kind} / {row.status}
        </span>
      </div>
      {row.full_name && <p>{day(row.work_date)}</p>}
      {p.administratorCorrection && (
        <p>Correction recorded and approved by an administrator.</p>
      )}
      <p>
        {p.category} {p.type?.replaceAll("_", " ")}{" "}
        {p.start ? `${clock(p.start)} - ${clock(p.end!)}` : ""}
      </p>
      {p.originalIn !== undefined && (
        <p>
          {t("originalTimes")}: {clock(p.originalIn)} -{" "}
          {p.originalOut ? clock(p.originalOut) : t("onShift")}
        </p>
      )}
      <p className="request-explanation">{row.reason || t("noExplanation")}</p>
      {row.decision_reason && (
        <p>
          {t("decisionReason")}: {row.decision_reason}
        </p>
      )}
      {row.status === "approved" && row.kind === "absence" && (
        <p>{row.paid ? t("paidAbsencePolicy") : t("unpaidAbsence")}</p>
      )}
    </>
  );
}
function Decision({
  id,
  onSaved,
}: {
  id: string;
  onSaved: () => Promise<void>;
}) {
  return (
    <Form
      path={`/requests/${id}/decision`}
      build={(f) => ({
        approved: value(f, "approved") === "yes",
        reason: value(f, "reason"),
      })}
      onSaved={onSaved}
    >
      <label>
        {t("decision")}
        <select name="approved">
          <option value="yes">{t("approve")}</option>
          <option value="no">{t("reject")}</option>
        </select>
      </label>
      <Field label="decisionReason" name="reason" />
    </Form>
  );
}
export function NotificationPreferences() {
  const { data, error, reload } = useResource<{
    enabled: number;
    reminders: number;
    encouragement: number;
  }>("/notifications/preferences");
  return (
    <details className="panel attendance-panel request-composer">
      <summary>{t("telegramNotifications")}</summary>
      <p>{t("notificationHelp")}</p>
      <ErrorNotice error={error} />
      {data && (
        <Form
          key={`${data.enabled}:${data.reminders}:${data.encouragement}`}
          path="/notifications/preferences"
          build={(f) => ({
            enabled: f.has("enabled"),
            reminders: f.has("reminders"),
            encouragement: f.has("encouragement"),
          })}
          onSaved={reload}
        >
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={!!data.enabled}
            />
            {t("enableNotifications")}
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="reminders"
              defaultChecked={!!data.reminders}
            />
            {t("shiftReminders")}
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="encouragement"
              defaultChecked={!!data.encouragement}
            />
            Friendly encouragement during my shift (1–2 messages)
          </label>
        </Form>
      )}
    </details>
  );
}
export type RequestKind = "absence" | "correction" | "overtime" | null;
export function EmployeeRequests({
  activeKind,
  onKindChange,
}: {
  activeKind: RequestKind;
  onKindChange: (kind: RequestKind) => void;
}) {
  const { data, error, reload } = useResource<Requests>("/requests/mine", 30),
    categories = useResource<{ id: string; label: string; paid: number }[]>(
      "/requests/categories",
    ),
    [workDate, setWorkDate] = useState(localDate()),
    sessions = useResource<{
      sessions: {
        id: string;
        check_in: number;
        check_out: number | null;
        manual: number;
      }[];
    }>(`/attendance/history?from=${workDate}&to=${workDate}`);
  return (
    <div className="attendance-stack">
      <details
        id="absence-form"
        className="panel attendance-panel request-composer"
        open={activeKind === "absence"}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            onKindChange(activeKind === "absence" ? null : "absence");
          }}
        >
          {t("cantComeToday")}
        </summary>
        <p>{t("absenceHelp")}</p>
        <Form
          path="/requests"
          build={(f) => ({
            kind: "absence",
            date: value(f, "date"),
            category: value(f, "category"),
            reason: value(f, "reason"),
          })}
          onSaved={reload}
        >
          <Field label="workDate" name="date" type="date" value={localDate()} />
          <label>
            {t("absenceCategory")}
            <select name="category">
              {categories.data?.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.label}
                  {c.paid ? " (paid policy)" : ""}
                </option>
              ))}
            </select>
          </label>
          <Field label="explanation" name="reason" required={false} />
        </Form>
        <ErrorNotice error={categories.error} />
      </details>
      <details
        className="panel attendance-panel request-composer"
        open={activeKind === "correction"}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            onKindChange(activeKind === "correction" ? null : "correction");
          }}
        >
          {t("requestCorrection")}
        </summary>
        <p>{t("correctionHelp")}</p>
        <Form
          path="/requests"
          build={(f) => ({
            kind: "correction",
            date: value(f, "date"),
            type: value(f, "type"),
            sessionId: value(f, "sessionId") || null,
            start: time(f, "start"),
            end: time(f, "end"),
            reason: value(f, "reason"),
          })}
          onSaved={async () => {
            await reload();
            await sessions.reload();
          }}
        >
          <label>
            {t("workDate")}
            <input
              type="date"
              name="date"
              value={workDate}
              onChange={(e) => e.target.value && setWorkDate(e.target.value)}
              required
            />
          </label>
          <label>
            {t("correctionType")}
            <select name="type">
              <option value="missing_check_in">{t("missingCheckIn")}</option>
              <option value="missing_check_out">{t("missingCheckOut")}</option>
              <option value="qr_unavailable">{t("qrUnavailable")}</option>
              <option value="wrong_check_in">{t("wrongCheckIn")}</option>
              <option value="wrong_check_out">{t("wrongCheckOut")}</option>
            </select>
          </label>
          <label>
            {t("attendanceSession")}
            <select key={workDate} name="sessionId">
              <option value="">{t("missingSession")}</option>
              {sessions.data?.sessions
                .filter((s) => !s.manual)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {clock(s.check_in)} -{" "}
                    {s.check_out ? clock(s.check_out) : t("onShift")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("requestedCheckIn")}
            <input
              type="time"
              name="start"
              step="1"
              defaultValue="08:00:00"
              required
            />
          </label>
          <label>
            {t("requestedCheckOut")}
            <input
              type="time"
              name="end"
              step="1"
              defaultValue="17:00:00"
              required
            />
          </label>
          <Field label="explanation" name="reason" />
        </Form>
        <ErrorNotice error={sessions.error} />
      </details>
      <details
        className="panel attendance-panel request-composer"
        open={activeKind === "overtime"}
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            onKindChange(activeKind === "overtime" ? null : "overtime");
          }}
        >
          {t("requestOvertime")}
        </summary>
        <p>{t("overtimeRequestHelp")}</p>
        <Form
          path="/requests"
          build={(f) => ({
            kind: "overtime",
            date: value(f, "date"),
            start: time(f, "start"),
            end: time(f, "end"),
            reason: value(f, "reason"),
          })}
          onSaved={reload}
        >
          <Field label="workDate" name="date" type="date" value={localDate()} />
          <Field label="startTime" name="start" type="time" value="17:00" />
          <Field label="endTime" name="end" type="time" value="18:00" />
          <Field label="explanation" name="reason" />
        </Form>
      </details>
      <section className="panel attendance-panel">
        <h2>{t("myRequests")}</h2>
        <p>{t("requestLimit")}</p>
        <ErrorNotice error={error} />
        {data?.requests.length ? (
          data.requests.map((r) => (
            <article className="request-card" key={r.id}>
              <Details row={r} />
            </article>
          ))
        ) : (
          <p>{t("noRequests")}</p>
        )}
        {data?.coverage.map((r) => (
          <article className="request-card" key={r.id}>
            <strong>
              {t("shiftCoverage")} / {r.status}
            </strong>
            <p>
              {day(r.work_date)}: {clock(r.start_at)} - {clock(r.end_at)}
            </p>
            {r.status === "pending" && (
              <Form
                path={`/coverage/${r.id}/decision`}
                build={(f) => ({
                  accepted: value(f, "accepted") === "yes",
                  reason: value(f, "reason"),
                })}
                onSaved={reload}
              >
                <label>
                  {t("decision")}
                  <select name="accepted">
                    <option value="yes">{t("acceptCoverage")}</option>
                    <option value="no">{t("declineCoverage")}</option>
                  </select>
                </label>
                <Field label="explanation" name="reason" />
              </Form>
            )}
          </article>
        ))}
      </section>
      <NotificationPreferences />
    </div>
  );
}
export function RequestManager({ superAdmin }: { superAdmin: boolean }) {
  const { data, error, reload } = useResource<Requests>("/requests/review", 30),
    people = useResource<{ employees: Person[] }>("/attendance/people"),
    categories = useResource<{ id: string; label: string; paid: number }[]>(
      "/requests/categories",
    ),
    [filter, setFilter] = useState("pending"),
    [showDisabled, setShowDisabled] = useState(
      !!selectionFor("requests")?.employeeId,
    );
  const targetEmployee = selectionFor("requests")?.employeeId;
  const target = selectionFor("requests");
  const targetRequest = target?.taskKind === "pending_request" ? target.subjectId : undefined;
  const visible = (row: { id?: string; employee_id: string }) =>
    (!targetRequest || row.id === targetRequest) &&
    (!targetEmployee || row.employee_id === targetEmployee) &&
    (showDisabled ||
      !!people.data?.employees.find((p) => p.id === row.employee_id)?.active);
  return (
    <div className="attendance-stack">
      <EmployeeFocus
        page="requests"
        name={
          people.data?.employees.find((p) => p.id === targetEmployee)
            ?.full_name ?? "selected employee"
        }
      />
      <section className="panel attendance-panel">
        <div className="filter-bar">
          <MoreOptions active={showDisabled}>
            <EmployeeVisibility
              showDisabled={showDisabled}
              onChange={setShowDisabled}
              disabledCount={
                people.data?.employees.filter((p) => !p.active).length ?? 0
              }
            />
          </MoreOptions>
          <label>
            {t("filterStatus")}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="pending">{t("pending")}</option>
              <option value="approved">{t("approve")}</option>
              <option value="rejected">{t("reject")}</option>
              <option value="all">{t("all")}</option>
            </select>
          </label>
        </div>
        <ErrorNotice error={error} />
        <EmployeeCards
          name={(id) =>
            people.data?.employees.find((p) => p.id === id)?.full_name ?? id
          }
          rows={(data?.requests ?? [])
            .filter(
              (r) => visible(r) && (filter === "all" || r.status === filter),
            )
            .map((r) => ({
              employeeId: r.employee_id,
              key: r.id,
              content: (
                <article key={r.id} className="request-card">
                  <Details row={r} />
                  {r.status === "pending" && (
                    <details className="request-decision">
                      <summary>Review request</summary>
                      <Decision id={r.id} onSaved={reload} />
                    </details>
                  )}
                </article>
              ),
            }))}
        />
        {!data?.requests.some(
          (r) => visible(r) && (filter === "all" || r.status === filter),
        ) && <p>{t("noRequests")}</p>}
      </section>
      <details className="panel attendance-panel request-composer">
        <summary>{t("shiftCoverage")}</summary>
        <p>{t("coverageHelp")}</p>
        <ErrorNotice error={people.error} />
        <Form
          path="/coverage"
          build={(f) => {
            const absent = data!.requests.find(
              (r) => r.id === value(f, "absenceId"),
            )!;
            f.set("date", absent.work_date);
            return {
              absenceId: absent.id,
              employeeId: value(f, "employeeId"),
              start: time(f, "start"),
              end: time(f, "end"),
              requiresAcceptance: f.has("requiresAcceptance"),
              overtimeApproved: f.has("overtimeApproved"),
              reason: value(f, "reason"),
            };
          }}
          onSaved={reload}
        >
          <label>
            {t("approvedAbsence")}
            <select name="absenceId" required>
              <option value="">{t("chooseAbsence")}</option>
              {data?.requests
                .filter(
                  (r) =>
                    visible(r) &&
                    r.kind === "absence" &&
                    r.status === "approved" &&
                    r.work_date >= localDate() &&
                    !data.coverage.some(
                      (c) => c.absence_id === r.id && c.status !== "declined",
                    ),
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name} / {day(r.work_date)}
                  </option>
                ))}
            </select>
          </label>
          <PersonSelect
            people={(people.data?.employees ?? []).filter(
              (p) => showDisabled || !!p.active,
            )}
          />
          <Field label="startTime" name="start" type="time" value="08:00" />
          <Field label="endTime" name="end" type="time" value="17:00" />
          <label className="checkbox-row">
            <input name="requiresAcceptance" type="checkbox" defaultChecked />
            {t("requireAcceptance")}
          </label>
          <label className="checkbox-row">
            <input name="overtimeApproved" type="checkbox" required />
            {t("approveCoverageOvertime")}
          </label>
          <Field label="explanation" name="reason" />
        </Form>
        {data?.coverage.filter(visible).map((c) => (
          <article className="request-card" key={c.id}>
            <strong>
              {c.full_name} / {c.status}
            </strong>
            <p>
              {day(c.work_date)} / {clock(c.start_at)} - {clock(c.end_at)}
            </p>
          </article>
        ))}
      </details>
      {superAdmin && (
        <details className="panel attendance-panel request-composer">
          <summary>{t("absencePolicy")}</summary>
          <p>{t("absencePolicyHelp")}</p>
          <ErrorNotice error={categories.error} />
          {categories.data?.map((c) => (
            <article key={c.id} className="request-card">
              <h3>
                {c.label} / {c.paid ? t("paid") : t("unpaid")}
              </h3>
              <Form
                path={`/requests/categories/${c.id}`}
                build={(f) => ({
                  paid: f.has("paid"),
                  reason: value(f, "reason"),
                })}
                onSaved={categories.reload}
              >
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    name="paid"
                    defaultChecked={!!c.paid}
                  />
                  {t("authorizePaidCategory")}
                </label>
                <Field label="explanation" name="reason" />
              </Form>
            </article>
          ))}
        </details>
      )}
      <NotificationPreferences />
    </div>
  );
}
