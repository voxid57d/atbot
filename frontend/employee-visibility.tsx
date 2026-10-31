import { t } from "./text";

// A visible on/off switch rather than plain text, so it reads as a setting.
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
      role="switch"
      className="employee-visibility"
      aria-checked={showDisabled}
      onClick={() => onChange(!showDisabled)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      {t("showDisabledEmployees")}
      {disabledCount > 0 && ` (${disabledCount})`}
    </button>
  );
}
