import { useState } from "react";
import { localDate, formatMoney } from "../shared/domain";
import { Form, Field, ErrorNotice, useResource, hours, day } from "./ui";
type Policy = {
  id: number;
  enabled: number;
  threshold_minutes: number | null;
  hourly_rate: number | null;
  effective_date: string;
};
export function RoleDailyPay({
  roleId,
  active,
}: {
  roleId: string;
  active: boolean;
}) {
  const resource = useResource<{ history: Policy[] }>(
    `/roles/${roleId}/daily-pay`,
  );
  const current = resource.data?.history.find(
    (p) => p.effective_date <= localDate(),
  );
  return (
    // Off and never configured: a quiet link instead of a full section.
    <details className={`role-daily-pay ${current?.enabled ? "on" : "off"}`}>
      <summary>
        {current?.enabled
          ? `Extended-hours rate · after ${hours(current.threshold_minutes! * 60)}`
          : "+ Extended-hours rate"}
      </summary>
      <p>
        For this role, use a different hourly rate after the chosen number of
        salary-counted hours each day. Regular time and approved overtime count
        together; the total resets daily.
      </p>
      <ErrorNotice error={resource.error} />
      {resource.data && active && (
        <PolicyForm
          key={resource.data.history[0]?.id ?? "new"}
          roleId={roleId}
          policy={current}
          onSaved={resource.reload}
        />
      )}
      {!!resource.data?.history.length && (
        <details>
          <summary>Rule history and upcoming changes</summary>
          {resource.data.history.map((p) => (
            <p key={p.id}>
              {day(p.effective_date)}:{" "}
              {p.enabled
                ? `${formatMoney(p.hourly_rate!)} / hour after ${hours(p.threshold_minutes! * 60)}`
                : "Rule off"}
            </p>
          ))}
        </details>
      )}
    </details>
  );
}
function PolicyForm({
  roleId,
  policy,
  onSaved,
}: {
  roleId: string;
  policy?: Policy;
  onSaved: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(!!policy?.enabled);
  return (
    <Form
      path={`/roles/${roleId}/daily-pay`}
      onSaved={onSaved}
      build={(f) => ({
        enabled,
        effectiveDate: String(f.get("effectiveDate")),
        reason: String(f.get("reason") ?? ""),
        ...(enabled
          ? {
              thresholdMinutes: Math.round(
                Number(f.get("thresholdHours")) * 60,
              ),
              hourlyRate: Number(f.get("hourlyRate")),
            }
          : {}),
      })}
    >
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable a different rate after daily hours
      </label>
      {enabled && (
        <>
          <label>
            Apply after how many hours per day?
            <input
              type="number"
              name="thresholdHours"
              min="0.0166666667"
              max="23.9833333333"
              step="any"
              required
              defaultValue={(policy?.threshold_minutes ?? 480) / 60}
            />
          </label>
          <label>
            Hourly rate after the threshold (UZS)
            <input
              type="number"
              name="hourlyRate"
              min="0"
              max="1000000000"
              step="1"
              required
              defaultValue={policy?.hourly_rate ?? ""}
            />
          </label>
          <p>
            This replaces the normal hourly rate for time beyond the threshold.
            Salary counts completed payable hours each day. Within that counted
            time, a threshold inside an hour splits the rates proportionally.
            This does not approve overtime.
          </p>
        </>
      )}
      <Field
        label="effectiveDate"
        name="effectiveDate"
        type="date"
        value={localDate()}
      />
      <Field label="reason" name="reason" required={false} />
    </Form>
  );
}
