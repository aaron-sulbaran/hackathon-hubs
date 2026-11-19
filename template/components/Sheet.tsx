"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

// A detail sheet: from the right on wide screens, from the bottom on phones.
// Escape or the scrim closes it; focus moves in on open.

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 animate-fade-in bg-[var(--scrim)]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative flex max-h-[88dvh] w-full animate-sheet-up flex-col rounded-t-[12px] bg-card shadow-float outline-none md:max-h-none md:w-[520px] md:animate-sheet-left md:rounded-none"
      >
        <div className="flex items-start gap-3 border-b border-hairline px-4 py-3">
          <h2 className="min-w-0 flex-1 text-[20px] leading-tight font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-button-2 text-ink-2 hover:brightness-95">
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
