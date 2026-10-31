import { navigateTo, selectionFor } from "./navigation";

export function EmployeeFocus({ page, name }: { page: string; name: string }) {
  const selected = selectionFor(page);
  if (!selected?.employeeId) return null;
  return (
    <p className="notice">
      Showing {name}.{" "}
      <button
        className="text-button"
        onClick={() => navigateTo(page, undefined, selected.date)}
      >
        Show all employees
      </button>
    </p>
  );
}
