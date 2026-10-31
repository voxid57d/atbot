import { day } from "./ui";
import { useEffect } from "react";
import { useResource, ErrorNotice } from "./ui";
import { navigateTo, salaryReview, setSalaryReview } from "./navigation";
import {
  canReviewTask,
  orderedSalaryTasks,
  salaryTaskLabel,
  salaryTaskPage,
  type ReviewPermissions,
  type SalaryWarning,
} from "./salary-tasks";

export function openSalaryTask(task: SalaryWarning) {
  navigateTo(salaryTaskPage(task.kind), task.employeeId, task.date, task.kind, task.subjectId);
}
export function SalaryReviewFlow({
  permissions,
}: {
  permissions: ReviewPermissions;
}) {
  const flow = salaryReview();
  const { data, error, loading, reload } = useResource<{
    warnings: SalaryWarning[];
  }>(flow ? `/payroll/preview?periodDate=${flow.periodDate}` : "", 30);
  useEffect(() => {
    if (!flow) return;
    const saved = () => void reload();
    window.addEventListener("workspace-mutation", saved);
    return () => window.removeEventListener("workspace-mutation", saved);
  }, [flow]);
  if (!flow) return null;
  const tasks = orderedSalaryTasks(
    data?.warnings.filter((w) => w.employeeId === flow.employeeId) ?? [],
  );
  const next = tasks.find((w) => canReviewTask(w, permissions));
  return (
    <aside className="salary-review-flow" aria-label="Salary review guide">
      <div>
        <strong>Salary review · {flow.name}</strong>
        <p>
          {loading
            ? "Checking remaining tasks…"
            : error
              ? "Unable to check remaining tasks."
              : next
                ? `${tasks.length} remaining · ${salaryTaskLabel(next.kind)} — ${day(next.date)}`
                : tasks.length
                  ? tasks.every((w) => w.state === "blocked") ? "Remaining reviews are waiting for their prerequisites."
                    : "Remaining tasks need another administrator's permission."
                  : "All salary review tasks are complete for this employee."}
        </p>
        <ErrorNotice error={error} />
      </div>
      <div className="salary-review-actions">
        {!!error && (
          <button className="secondary" onClick={() => void reload()}>
            Retry
          </button>
        )}
        {next && (
          <button
            className="primary"
            disabled={loading || !!error}
            onClick={() => openSalaryTask(next)}
          >
            Review next task
          </button>
        )}
        <button
          className="secondary"
          onClick={() => {
            setSalaryReview();
            navigateTo("payroll", flow.employeeId, flow.periodDate);
          }}
        >
          Back to monthly salaries
        </button>
      </div>
    </aside>
  );
}
