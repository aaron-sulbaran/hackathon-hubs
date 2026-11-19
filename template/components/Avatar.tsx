import { accentFor, initials } from "@/lib/web/people";
import type { Presence } from "@/lib/web/types";

// Initials on the person's accent, never a photo. The presence ring is told by
// shape first: a solid ring that breathes (an agent session is live), a dashed
// ring (the session went quiet for 45 minutes), or no ring (away).

export function Avatar({
  id,
  name,
  size = 40,
  presence,
  className = "",
}: {
  id: string;
  name: string;
  size?: number;
  presence?: Presence;
  className?: string;
}) {
  const accent = accentFor(id);
  const ringGap = Math.max(2, Math.round(size / 18));
  const ringWidth = Math.max(2, Math.round(size / 20));
  const outer = presence && presence !== "away" ? size + (ringGap + ringWidth) * 2 : size;
  const label = presence ? `${name}, ${presence === "active" ? "working now" : presence === "idle" ? "idle" : "away"}` : name;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: outer, height: outer }}
      role="img"
      aria-label={label}
    >
      {presence === "active" && (
        <span
          className="absolute inset-0 animate-working rounded-full"
          style={{ border: `${ringWidth}px solid var(--primary)` }}
          aria-hidden="true"
        />
      )}
      {presence === "idle" && (
        <svg className="absolute inset-0" width={outer} height={outer} viewBox={`0 0 ${outer} ${outer}`} aria-hidden="true">
          <circle
            cx={outer / 2}
            cy={outer / 2}
            r={(outer - ringWidth) / 2}
            fill="none"
            stroke="var(--ink-2)"
            strokeWidth={ringWidth}
            strokeDasharray={`${ringWidth * 1.6} ${ringWidth * 1.8}`}
            strokeLinecap="round"
          />
        </svg>
      )}
      <span
        className="relative inline-flex items-center justify-center rounded-full font-semibold select-none"
        style={{
          width: size,
          height: size,
          background: accent.fill,
          color: accent.ink,
          fontSize: Math.round(size * 0.38),
          letterSpacing: "0.01em",
        }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
    </span>
  );
}
