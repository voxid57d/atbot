import { t } from "./text";

export function EmployeeVisibility({
  showDisabled,
  onChange,
  disabledCount,
}: {
  showDisabled: boolean;
  onChange: (show: boolean) => void;
  disabledCount: number;
}) {
  return (
    <button
      type="button"
      className="secondary compact employee-visibility"
      aria-pressed={showDisabled}
      onClick={() => onChange(!showDisabled)}
    >
      {t(showDisabled ? "hideDisabledEmployees" : "showDisabledEmployees")}
      {disabledCount > 0 && ` (${disabledCount})`}
    </button>
  );
}
