import type { ReactNode } from "react";

export function EmployeeCards({
  rows,
  name,
  collapsible = false,
  expanded = false,
  summary,
}: {
  rows: { employeeId: string; key: string; content: ReactNode }[];
  name: (id: string) => string;
  collapsible?: boolean;
  expanded?: boolean;
  summary?: (id: string) => ReactNode;
}) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.content) continue;
    const group = groups.get(row.employeeId) ?? [];
    group.push(row);
    groups.set(row.employeeId, group);
  }
  return (
    <div className="employee-card-grid">
      {[...groups]
        .sort(([a], [b]) => name(a).localeCompare(name(b)))
        .map(([id, items]) => (
          <section
            className="employee-card"
            data-employee-id={id}
            key={id}
            aria-label={name(id)}
          >
            <header className="employee-card-heading">
              <h3>{name(id)}</h3>
            </header>
            {summary && (
              <div className="employee-review-summary">{summary(id)}</div>
            )}
            {collapsible ? (
              <details className="employee-card-body" open={expanded}>
                <summary>
                  Review details · {items.length}{" "}
                  {items.length === 1 ? "record" : "records"}
                </summary>
                {items.map((row) => (
                  <div key={row.key}>{row.content}</div>
                ))}
              </details>
            ) : (
              <div className="employee-card-body">
                {items.map((row) => (
                  <div key={row.key}>{row.content}</div>
                ))}
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
