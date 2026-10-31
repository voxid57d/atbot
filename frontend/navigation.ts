export type Destination = {
  page: string;
  employeeId?: string;
  date?: string;
  taskKind?: string;
  subjectId?: string;
};
export type SalaryReview = {
  employeeId: string;
  name: string;
  periodDate: string;
};
let selected: Destination | undefined;
let review: SalaryReview | undefined;
export const salaryReview = () => review;
export function setSalaryReview(value?: SalaryReview) {
  review = value;
}
export function selectionFor(page: string) {
  return selected?.page === page ? selected : undefined;
}
export function navigateTo(
  page: string,
  employeeId?: string,
  date?: string,
  taskKind?: string,
  subjectId?: string,
) {
  selected = { page, employeeId, date, taskKind, subjectId };
  window.dispatchEvent(
    new CustomEvent<Destination>("workspace-navigate", { detail: selected }),
  );
}
export function clearSelection() {
  selected = undefined;
  review = undefined;
}
