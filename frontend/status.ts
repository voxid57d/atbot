export function statusClass(status: string) {
  if (
    [
      "Working",
      "Finished",
      "Approved absence",
      "approved",
      "completed",
      "confirmed",
      "finalized",
      "active",
      "scheduled",
    ].includes(status)
  )
    return "status-good";
  if (
    [
      "Absence pending",
      "Not checked in",
      "pending",
      "detected",
      "open",
      "forgotten",
    ].includes(status)
  )
    return "status-attention";
  if (["rejected", "bad"].includes(status)) return "status-danger";
  return "status-neutral";
}
