import type { ReactNode } from "react";

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-card bg-card shadow-card ${className}`}>
      {children}
    </section>
  );
}

export function CardHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
      <h2 className="text-[17px] leading-tight font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

/** Says what will appear here and how it gets here. The hub starts nearly empty. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-5 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-snug text-ink-2">{children}</p>
    </div>
  );
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "primary" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] leading-4 font-semibold ${
        tone === "primary" ? "bg-tint text-primary" : "bg-button-2 text-ink-2"
      }`}
    >
      {children}
    </span>
  );
}
