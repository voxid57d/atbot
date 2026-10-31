import { useState } from "react";
import { Field, Form } from "./ui";
import { formatMoney } from "../shared/domain";
export type StoredFineDecision = {
  violation_id: string; employee_id: string; work_date: string; progression_token: string;
  status: string; amount: number; reason: string; decided_at?: number; decided_by_name?: string | null;
};
export function DecisionStamp({ decision }: { decision: { decided_at?: number; decided_by_name?: string | null } }) {
  if (!decision.decided_at && !decision.decided_by_name) return null;
  return <p className="muted decision-stamp">{decision.decided_by_name}{decision.decided_by_name && decision.decided_at ? " · " : ""}{decision.decided_at
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" }).format(decision.decided_at * 1000) + " (Tashkent)" : ""}</p>;
}

export type FineReview = {
  id: string;
  work_date: string;
  status: string;
  proposedFine: number | null;
  progressionToken: string;
  fineDecision: { status: string; amount: number; reason: string; decided_at?: number; decided_by_name?: string | null } | null;
};
export function FineDecision({ fine, revision, periodDate, onSaved }: {
  fine: FineReview; revision: number; periodDate: string; onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (fine.status === "detected") return <p className="notice">Confirm or excuse lateness before deciding its fine.</p>;
  if (fine.fineDecision && !editing) return <button type="button" className="text-button" onClick={() => setEditing(true)}>Change decision</button>;
  return <div className="fine-decision-editor">
    <Form path="/payroll/fines/decision"
      version={JSON.stringify([fine.progressionToken, fine.fineDecision])}
      build={(f) => {
        const rejected = f.get("decision") === "rejected";
        return { id: fine.id, periodDate, revision, status: rejected ? "rejected" : "approved",
          amount: rejected ? 0 : Number(f.get("amount")), reason: String(f.get("reason") ?? "") };
      }}
      onSaved={async () => { setEditing(false); await onSaved(); }}
      submitLabel="approveFine" alternateSubmit={{ label: "rejectFine", name: "decision", value: "rejected" }}>
      <p>Proposed: {formatMoney(fine.proposedFine ?? 0)}. Rejection records zero.</p>
      <Field label="adjustmentAmount" name="amount" type="number" min={0} max={fine.proposedFine ?? 0} step={1}
        value={String(fine.fineDecision?.amount ?? fine.proposedFine ?? 0)} />
      <Field label="reviewReason" name="reason" />
    </Form>
    {editing && <button type="button" className="text-button" onClick={() => setEditing(false)}>Cancel change</button>}
  </div>;
}
