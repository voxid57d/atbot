import { useEffect, useRef, type ReactNode } from "react";

export function MoreOptions({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      className="more-options"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          ref.current?.removeAttribute("open");
          ref.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>
        More options
        {active && (
          <span
            className="options-indicator"
            aria-label="Disabled employees are visible"
          >
            {" "}
            •
          </span>
        )}
      </summary>
      <div className="more-options-content">{children}</div>
    </details>
  );
}
