import { useState } from "react";
import { ErrorNotice, Form, useResource, day, HowItWorks } from "./ui";
import { formatMoney } from "../shared/domain";
import { debtorFields, debtResult, debtBands, debtBonus, type CashierBonus, type DebtorCounts, type DebtEntry } from "../shared/debtors";
type Data = { today: string; effectiveDate: string; revision: number; locked: boolean; history: DebtEntry[] };
const labels: Record<keyof DebtorCounts, string> = {
  d1: "Current debtors", d2: "Debtors >1 month", d3: "Archive debtors", d4: "Finished debtors",
  s1: "Students", s2: "Archive students", s3: "Finished students",
};
const zero: DebtorCounts = { d1: 0, d2: 0, d3: 0, d4: 0, s1: 0, s2: 0, s3: 0 };
type SalaryEntry = {
  employeeId: string;
  fullName: string;
  workedGross: number;
  finalPay: number;
  cashierBonus?: CashierBonus | null;
  days: { openSessions: number; unratedSeconds: number }[];
};
function CashierSalary({ entry, own = false }: { entry: SalaryEntry; own?: boolean }) {
  const bonus = entry.cashierBonus;
  if (!bonus) return null;
  const openSessions = entry.days.reduce((n, day) => n + day.openSessions, 0);
  const unratedSeconds = entry.days.reduce((n, day) => n + day.unratedSeconds, 0);
  return <article className="employee-card payroll-employee-card">
    <h3>{own ? "My salary this month" : entry.fullName}</h3>
    <dl className="payroll-breakdown">
      <div><dt>Fixed earnings before adjustments</dt><dd>{formatMoney(entry.workedGross)}</dd></div>
      <div><dt>Cashier earnings eligible for bonus</dt><dd>{formatMoney(bonus.eligibleEarnings)}</dd></div>
      <div><dt>Debt bonus · {bonus.multiplier}×</dt><dd>{formatMoney(bonus.amount)}</dd></div>
      <div><dt>Total after fines and other adjustments</dt><dd>{formatMoney(entry.finalPay)}</dd></div>
    </dl>
    {bonus.percentage === null && <p className="notice">Save debtor counts to calculate the bonus.</p>}
    {!!openSessions && <p className="notice">{openSessions} attendance session(s) still open. Their earnings and bonus will be calculated after checkout.</p>}
    {!!unratedSeconds && <p className="notice">Some worked time has no hourly rate. Configure the historical rate to calculate its earnings and bonus.</p>}
    {bonus.eligibleEarnings === 0 && !openSessions && !unratedSeconds && <p className="notice">No payable cashier earnings yet this month. Only work while assigned as a cashier counts toward this bonus.</p>}
    {bonus.percentage !== null && bonus.multiplier === 1 && <p className="notice">Debt is 30% or higher, so there is no debt bonus.</p>}
  </article>;
}
function CountsForm({ data, saved }: { data: Data; saved: () => Promise<void> }) {
  const [values, setValues] = useState(() => Object.fromEntries(debtorFields.map((key) => [key, String(data.history[0]?.[key] ?? zero[key])])) as Record<keyof DebtorCounts, string>);
  const counts = Object.fromEntries(debtorFields.map((key) => [key, Number(values[key])])) as DebtorCounts;
  const input = (key: keyof DebtorCounts) => <label key={key}>{labels[key]}<input
    type="number" min="0" max="10000000" step="1" required name={key} value={values[key]}
    onFocus={() => { if (values[key] === "0") setValues((v) => ({ ...v, [key]: "" })); }}
    onBlur={() => { if (values[key] === "") setValues((v) => ({ ...v, [key]: "0" })); }}
    onChange={(e) => { const value = e.target.value.replace(/^0+(?=\d)/, ""); setValues((v) => ({ ...v, [key]: value })); }}
  /></label>;
  const [revision] = useState(data.revision);
  const result = debtResult(counts);
  return <section className="panel attendance-panel">
    <h2>Enter shared debtor counts</h2>
    <HowItWorks><p>You can save several times a day. Only the latest save counts as that day's data and updates every cashier's current bonus. Earlier saves remain in the audit record.</p></HowItWorks>
    {data.locked ? <p className="notice">This month's payroll is locked. A payroll approver must reopen it before figures can change.</p> :
      <Form path="/debtors" build={() => ({ ...Object.fromEntries(debtorFields.map((key) => [key, counts[key]])), revision })} onSaved={saved}>
        <fieldset className="debt-counts"><legend>Debtors</legend>
          {debtorFields.slice(0, 4).map(input)}
        </fieldset>
        <fieldset className="debt-counts"><legend>Students</legend>
          {debtorFields.slice(4).map(input)}
        </fieldset>
        <p aria-live="polite">{result ? `${result.debtors} ÷ ${result.students} × 100 = ${result.percentage.toFixed(2)}% · ${result.multiplier}× salary multiplier` : "Enter at least one student to calculate the percentage."}</p>
        <p className="muted">If someone saves new figures while you edit, refresh before saving again.</p>
      </Form>}
  </section>;
}
export function DebtorsScreen({ hasEmployee, canViewPayroll }: { hasEmployee: boolean; canViewPayroll: boolean }) {
  const { data, error, reload } = useResource<Data>("/debtors", 60);
  const mine = useResource<{ status: string; entry: SalaryEntry | null }>(hasEmployee ? "/payroll/mine" : "", 60);
  const payroll = useResource<{ status: string; entries: SalaryEntry[]; disabledEmployeeIds: string[] }>(canViewPayroll ? "/payroll/preview" : "", 60);
  const [formVersion, setFormVersion] = useState(0);
  async function refresh() { await Promise.all([reload(), mine.reload(), payroll.reload()]); setFormVersion((v) => v + 1); }
  const latest = data?.history[0], result = latest ? debtResult(latest) : null;
  const own = mine.data?.entry, bonus = own?.cashierBonus;
  const daily = data ? [...new Map([...data.history].reverse().map((r) => [r.work_date, r])).values()] : [];
  const max = Math.max(30, ...daily.map((r) => debtResult(r)!.percentage));
  return <div className="attendance-stack debtors-screen">
    <ErrorNotice error={error || mine.error || payroll.error} />
    <section className="panel attendance-panel">
      <h2>Debt share this month</h2>
      <HowItWorks><p>One shared debt percentage applies separately to each cashier's earnings for the whole month, from the first day. Only earnings while assigned as a cashier count. Bonuses are provisional until payroll approval.</p></HowItWorks>
      <button className="secondary" onClick={() => void refresh()}>Refresh data</button>
      {!data && <p>Loading shared data…</p>}
      {data && <dl className="payroll-breakdown">
        <div><dt>Latest debt percentage</dt><dd>{result ? `${result.percentage.toFixed(2)}%` : "Awaiting data"}</dd></div>
        <div><dt>Salary multiplier</dt><dd>{result ? `${result.multiplier}×` : "—"}</dd></div>
        <div><dt>Last saved (Tashkent)</dt><dd>{latest ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" }).format(latest.created_at * 1000) : "No entry this month"}</dd></div>
      </dl>}
    </section>
    {bonus && own && <section className="panel attendance-panel">
      <CashierSalary entry={own} own />
      <HowItWorks><p>Bonus = eligible earnings × (multiplier − 1). Approved overtime and extended-hours pay count. Fines, deductions, leave pay and other bonuses do not change this bonus.</p></HowItWorks>
      <p className="muted">{mine.data?.status === "finalized" ? "Approved payroll snapshot" : "Current estimate; updates as attendance and debtor data change."} Full details are in My salary.</p>
    </section>}
    {canViewPayroll && <section className="panel attendance-panel">
      <h2>Cashier salaries this month</h2>
      <HowItWorks><p>Bonus = eligible attendance earnings × (multiplier − 1). Fines and deductions apply afterward. Open sessions are not payable until checkout.</p></HowItWorks>
      {!payroll.data && <p>Loading cashier bonuses…</p>}
      {payroll.data && <>
        <p className="muted">{payroll.data.status === "finalized" ? "Approved payroll snapshot" : "Current estimates; refresh after attendance or debtor figures change."}</p>
        {payroll.data.entries.filter((entry) => entry.cashierBonus && !payroll.data!.disabledEmployeeIds.includes(entry.employeeId)).map((entry) => <CashierSalary key={entry.employeeId} entry={entry} />)}
        {!payroll.data.entries.some((entry) => entry.cashierBonus && !payroll.data!.disabledEmployeeIds.includes(entry.employeeId)) && <p>No active cashier salary records for this month. Assign a Cashier level under Employees. Full payroll, including disabled employees, is available in Monthly salaries.</p>}
      </>}
    </section>}
    {data && <CountsForm key={formVersion} data={data} saved={refresh} />}
    <section className="panel attendance-panel">
      <h2>Daily dynamics</h2>
      <HowItWorks><p>One record per day: only the last save is shown and used. You can update today's figures several times; the last save becomes the day's final record. The latest figures stay in effect until replaced.</p></HowItWorks>
      {daily.length > 0 ? <svg className="debt-chart" viewBox="0 0 600 170" role="img" aria-label="Daily debt percentages; exact values follow in the history table">
        <line x1="30" y1="140" x2="580" y2="140" stroke="currentColor" opacity="0.2" />
        <text x="0" y="145" fontSize="11">0%</text><text x="0" y="20" fontSize="11">{max.toFixed(0)}%</text>
        <polyline fill="none" stroke="#8b5cf6" strokeWidth="3" points={daily.map((r, i) => `${30 + i * 550 / Math.max(1, daily.length - 1)},${140 - debtResult(r)!.percentage / max * 120}`).join(" ")} />
        {daily.map((r, i) => <circle key={r.id} cx={30 + i * 550 / Math.max(1, daily.length - 1)} cy={140 - debtResult(r)!.percentage / max * 120} r="4" fill="#8b5cf6"><title>{day(r.work_date)}: {debtResult(r)!.percentage.toFixed(2)}%</title></circle>)}
        <text x="30" y="165" fontSize="11">{daily[0].work_date}</text><text x="580" y="165" textAnchor="end" fontSize="11">{daily.length > 1 ? daily.at(-1)!.work_date : ""}</text>
      </svg> : <p>No entries this month.</p>}
      {bonus && <p className="muted">Bonus comparisons below use your current eligible earnings ({formatMoney(bonus.eligibleEarnings)}) for every entry, to show the effect of changing debt levels.</p>}
      {data && data.history.length > 0 && <div className="debt-table-scroll"><table>
        <thead><tr><th>Saved (Tashkent)</th><th>Debtors / students</th><th>Debt %</th><th>Multiplier</th>{bonus && <th>Bonus on current earnings</th>}</tr></thead>
        <tbody>{data.history.map((r) => { const d = debtResult(r)!; return <tr key={r.id}><td>{day(r.work_date)} {new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", timeStyle: "short" }).format(r.created_at * 1000)}{r.id === latest?.id ? " · Latest" : ""}</td><td>{d.debtors} / {d.students}<details><summary>Counts</summary>{debtorFields.map((key) => <p key={key}>{labels[key]}: {r[key]}</p>)}</details></td><td>{d.percentage.toFixed(2)}%</td><td>{d.multiplier}×</td>{bonus && <td>{formatMoney(debtBonus(bonus.eligibleEarnings, r).amount)}</td>}</tr>; })}</tbody>
      </table></div>}
    </section>
    <details className="panel attendance-panel"><summary>Bonus multiplier table</summary><p>Lower boundaries are included. Upper boundaries are excluded. Exactly zero receives 2.5×. Bands use the full percentage before display rounding.</p><dl className="payroll-breakdown">{debtBands.map((b) => <div key={b.label}><dt>{b.label}</dt><dd>{b.multiplier}×{b.multiplier === 1 ? " · no bonus" : ""}</dd></div>)}</dl></details>
  </div>;
}
