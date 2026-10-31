export function MonthPicker({
  value,
  onChange,
  label = "Salary month",
}: {
  value: string;
  onChange: (date: string) => void;
  label?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="month"
        value={value.slice(0, 7)}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value + "-01");
        }}
      />
    </label>
  );
}
export const monthName = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Tashkent",
  }).format(new Date(date + "T12:00:00+05:00"));
