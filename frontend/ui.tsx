import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "./api";
import { t, type TextKey } from "./text";
import type { regularShiftAttendance } from "../shared/attendance";
// One display format everywhere: times as 16:47, dates as 31 Oct 2026 (Tashkent).
export const clock = (seconds: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  }).format(seconds * 1000);
export const day = (isoDate: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(Date.parse(isoDate + "T00:00:00Z"))
    : isoDate;
export const hours = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
export type ShiftAttendance = ReturnType<typeof regularShiftAttendance>[number];
export function ShiftAttendanceDetails({ rows }: { rows?: ShiftAttendance[] }) {
  if (!rows || rows.length < 2) return null;
  return <div className="shift-attendance-details">{rows.map((s) => <p key={s.shiftId}>
    <strong>{clock(s.start_at).slice(0, 5)}–{clock(s.end_at).slice(0, 5)}</strong>
    {` · Late ${s.lateMinutes}m · Early departure ${hours(s.earlyDepartureSeconds)}`}
  </p>)}</div>;
}
// Long explanations stay available without pushing the controls down the page.
export function HowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="how-it-works">
      <summary>How this works</summary>
      {children}
    </details>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}
export function useResource<T>(path: string, refreshSeconds = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    generation = useRef(0);
  async function reload() {
    if (!path) {
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    try {
      const value = await api<T>(path);
      if (current === generation.current) {
        setData(value);
        setError("");
      }
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setData(null);
    void reload();
    const timer = refreshSeconds
      ? setInterval(() => {
          if (document.visibilityState === "visible") void reload();
        }, refreshSeconds * 1000)
      : undefined;
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [path, refreshSeconds]);
  return { data, error, loading, reload };
}
export function Form({
  path,
  build,
  onSaved,
  children,
  submitLabel = "save",
  version,
  alternateSubmit,
}: {
  path: string;
  build: (data: FormData) => unknown;
  onSaved?: () => void | Promise<void>;
  children?: ReactNode;
  submitLabel?: TextKey;
  version?: string;
  alternateSubmit?: { label: TextKey; name: string; value: string };
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false),
    operation = useRef<{ payload: string; key: string } | null>(null);
  const dirty = useRef(false);
  const [acceptedVersion, setAcceptedVersion] = useState(version);
  const [formVersion, setFormVersion] = useState(0);
  const stale = version !== acceptedVersion;
  function resetDraft() {
    dirty.current = false;
    operation.current = null;
    setError("");
    setSuccess(false);
    setAcceptedVersion(version);
    setFormVersion((n) => n + 1);
  }
  useEffect(() => {
    if (version !== acceptedVersion && !dirty.current) resetDraft();
  }, [version, acceptedVersion]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || stale) return;
    setBusy(true);
    setSuccess(false);
    setError("");
    try {
      const submitter = (e.nativeEvent as SubmitEvent).submitter;
      const input = build(new FormData(e.currentTarget, submitter)),
        payload = JSON.stringify(input);
      if (operation.current?.payload !== payload)
        operation.current = { payload, key: crypto.randomUUID() };
      await api(path, "POST", input, operation.current!.key);
      dirty.current = false;
      setSuccess(true);
      await onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      key={formVersion}
      className="attendance-form"
      onSubmit={(e) => void submit(e)}
      onChange={() => {
        dirty.current = true;
        if (success) {
          setSuccess(false);
          operation.current = null;
        }
      }}
    >
      {children}
      {stale && (
        <div className="notice" role="status">
          <p>This record changed. Your draft is preserved; load the current values before deciding.</p>
          <button type="button" className="secondary" onClick={resetDraft}>Load current values</button>
        </div>
      )}
      <ErrorNotice error={error} />
      {success && (
        <p className="success" role="status">
          {t("confirmed")}
        </p>
      )}
      <button className="primary" disabled={busy || success || stale}>
        {busy ? t("saving") : t(submitLabel)}
      </button>
      {alternateSubmit && <button type="submit" className="secondary" name={alternateSubmit.name}
        value={alternateSubmit.value} formNoValidate disabled={busy || success || stale}>{t(alternateSubmit.label)}</button>}
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  value,
  required = true,
  min,
  max,
  step,
}: {
  label: TextKey;
  name: string;
  type?: string;
  value?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label>
      {t(label)}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={name !== "reason" && required}
        maxLength={name === "reason" ? 1000 : undefined}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
export type Person = {
  id: string;
  full_name: string;
  active: number | boolean;
};
export function PersonSelect({
  people,
  value,
  onChange,
}: {
  people: Person[];
  value?: string;
  onChange?: (id: string) => void;
}) {
  return (
    <label>
      {t("employee")}
      <select
        name="employeeId"
        required
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="">{t("chooseEmployee")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
            {p.active ? "" : ` (${t("inactive")})`}
          </option>
        ))}
      </select>
    </label>
  );
}
