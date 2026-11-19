"use client";

import { useEffect, useRef, useState } from "react";

// One tap puts a page on the clipboard as a block a teammate's coding agent can
// read cold: where it came from, then the page itself. The button says Copied
// at once; when the browser refuses, the text opens selected for a manual copy.

export function CopyForAI({ text, label = "Copy for your AI" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (state === "manual") box.current?.select();
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 2400);
    } catch {
      setState("manual");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={copy}
        className="flex min-h-11 items-center gap-2 rounded-full bg-tint px-4 text-[14px] font-semibold text-ink transition-colors hover:bg-hover"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {state === "copied" ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" /></>}
        </svg>
        <span role="status" aria-live="polite">{state === "copied" ? "Copied, paste it to your agent" : label}</span>
      </button>
      {state === "manual" && (
        <label className="w-full text-[13px] text-ink-2">
          Copying is blocked here. The text is selected: copy it with your keyboard.
          <textarea ref={box} readOnly value={text} rows={6} className="mt-1 block w-full rounded-control bg-card-flat p-2 font-mono text-[12px] text-ink" />
        </label>
      )}
    </div>
  );
}
