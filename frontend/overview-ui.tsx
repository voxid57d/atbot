import { can, localDate, type Identity } from "../shared/domain";
import { useResource } from "./ui";
import type { ReviewTask } from "../shared/review-tasks";

type Snapshot = {
  tasks?: ReviewTask[];
  employees?: { active: number; status: string; forgotten: boolean }[];
  requests?: { employee_id: string; status: string }[];
  coverage?: unknown[];
  people?: { id: string; active: number }[];
  days?: {
    employee_id: string;
    qualityPending: boolean;
    uniform: { status: string } | null;
  }[];
  violations?: {
    employee_id: string;
    meetingRequired: boolean;
    meeting: unknown;
  }[];
  early?: { employee_id: string; review: unknown }[];
  warnings?: unknown[];
};
function Metric({
  title,
  path,
  target,
  hint,
  count,
  onNavigate,
}: {
  title: string;
  path: string;
  target: string;
  hint: string;
  count: (data: Snapshot) => number;
  onNavigate: (page: string) => void;
}) {
  const { data, error, loading, reload } = useResource<Snapshot>(path, 60);
  const people = useResource<{ employees: { id: string; active: number }[] }>(
    target === "requests" ? "/attendance/people" : "",
    target === "requests" ? 60 : 0,
  );
  const ready = target !== "requests" || !!people.data;
  return (
    <section className="panel dashboard-metric">
      <button className="dashboard-link" onClick={() => onNavigate(target)}>
        <span>{title}</span>
        <strong>
          {data && ready
            ? count(
                target === "requests"
                  ? { ...data, people: people.data!.employees }
                  : data,
              )
            : "—"}
        </strong>
        <small>{hint} →</small>
      </button>
      {(error || people.error) && (
        <div className="metric-error" role="alert">
          <p>{error || people.error}</p>
          <button
            className="secondary compact"
            onClick={() => {
              void reload();
              if (target === "requests") void people.reload();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {loading && !data && <small role="status">Loading…</small>}
    </section>
  );
}
export function Overview({
  user,
  onNavigate,
}: {
  user: Identity;
  onNavigate: (page: string) => void;
}) {
  const attendance = can(user, "attendance.manage"),
    payroll = can(user, "salary.manage") || can(user, "payroll.approve");
  return (
    <div className="attendance-stack">
      <div className="dashboard-grid">
        {attendance && (
          <>
            <Metric
              title="Working now"
              path={`/attendance/live?date=${localDate()}`}
              target="attendance"
              hint="Live attendance today"
              count={(d) =>
                d.employees?.filter((e) => e.active && e.status === "Working")
                  .length ?? 0
              }
              onNavigate={onNavigate}
            />
            <Metric
              title="Pending requests"
              path="/requests/review"
              target="requests"
              hint="Review employee requests"
              count={(d) => {
                const active = new Set(
                  d.people?.filter((p) => p.active).map((p) => p.id),
                );
                return (
                  d.requests?.filter(
                    (r) => r.status === "pending" && active.has(r.employee_id),
                  ).length ?? 0
                );
              }}
              onNavigate={onNavigate}
            />
            <Metric
              title="Pending reviews"
              path={`/discipline/review?periodDate=${localDate()}`}
              target="reviews"
              hint="Pending inbox decisions this month"
              count={(d) => {
                const active = new Set(
                  d.people?.filter((p) => p.active).map((p) => p.id),
                );
                return d.tasks?.filter((task) => active.has(task.employeeId)).length ?? 0;
              }}
              onNavigate={onNavigate}
            />
          </>
        )}
        {payroll && (
          <Metric
            title="Payroll issues"
            path={`/payroll/preview?periodDate=${localDate()}`}
            target="payroll"
            hint="All payroll review tasks this month"
            count={(d) => d.warnings?.length ?? 0}
            onNavigate={onNavigate}
          />
        )}
      </div>
      <p className="muted dashboard-help">
        Today’s attendance and this month’s review queues. Payroll warnings
        include outstanding items for disabled employees.
      </p>
    </div>
  );
}
