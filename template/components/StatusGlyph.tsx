// Status by shape first, color second, and never red or amber:
//   open      hollow ring
//   proposed  ring with its left half filled (an agent says it is ready)
//   done      filled disc with a check that draws itself
//   failed    hollow ring crossed by a slash
// The glyph is keyed on status by its callers, so a change remounts it and the
// new shape pops (or draws) in.

export type GlyphState = "open" | "proposed" | "done" | "failed";

export function glyphFor(status: string): GlyphState {
  if (["passed", "accepted", "settled", "done"].includes(status)) return "done";
  if (["failed", "rejected"].includes(status)) return "failed";
  if (status === "proposed") return "proposed";
  return "open";
}

export function StatusGlyph({ status, size = 18, label }: { status: string; size?: number; label?: string }) {
  const state = glyphFor(status);
  return (
    <svg
      key={state}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={state === "done" ? "shrink-0" : "shrink-0 animate-pop-in"}
      role="img"
      aria-label={label ?? status}
    >
      {state === "open" && <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink-2)" strokeWidth="1.75" />}
      {state === "proposed" && (
        <>
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--primary)" strokeWidth="1.75" />
          <path d="M10 2.5a7.5 7.5 0 0 0 0 15Z" fill="var(--primary)" />
        </>
      )}
      {state === "done" && (
        <>
          <circle cx="10" cy="10" r="8.5" fill="var(--primary)" className="animate-pop-in" />
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--primary)" strokeWidth="1.5" pathLength={1} className="check-ring" />
          <path
            d="m6.2 10.3 2.5 2.5 5.1-5.4"
            fill="none"
            stroke="var(--on-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="check-tick"
          />
        </>
      )}
      {state === "failed" && (
        <>
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink-2)" strokeWidth="1.75" />
          <path d="M5 15 15 5" stroke="var(--ink-2)" strokeWidth="1.75" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
