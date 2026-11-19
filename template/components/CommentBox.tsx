"use client";

import { useId, useState } from "react";
import { ActReceipt, useAct } from "./HubContext";
import { useDraft } from "./useDraft";

// A labeled box that posts one event about `refId`. The first line (up to 140
// characters) becomes the event title; anything longer also goes in as text.

export function splitTitle(body: string): { title: string; text?: string } {
  const trimmed = body.trim();
  const firstLine = trimmed.split("\n")[0] ?? "";
  if (trimmed.length <= 140 && !trimmed.includes("\n")) return { title: trimmed };
  const title = firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
  return { title, text: trimmed };
}

export function CommentBox({
  refId,
  type = "comment",
  label = "Comment",
  button = "Post",
  rows = 2,
  placeholder,
}: {
  refId: string;
  type?: "comment" | "question.answer" | "note";
  label?: string;
  button?: string;
  rows?: number;
  placeholder?: string;
}) {
  // The draft survives a live refresh, a remount, and a reload of this tab.
  const [body, setBody] = useDraft(`${type}:${refId}`, "");
  const { act, state } = useAct();
  const fieldId = useId();

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!body.trim()) return;
        const ok = await act({ type, ref: refId, ...splitTitle(body) });
        if (ok) setBody("");
      }}
    >
      <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={fieldId}
        value={body}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
        }}
        className="w-full resize-y rounded-control border-0 bg-card-flat px-3 py-2 text-[15px] text-ink placeholder:text-ink-2 focus:outline-2 focus:outline-primary"
      />
      <div className="flex items-center justify-between gap-2">
        <ActReceipt state={state} />
        <button
          type="submit"
          disabled={!body.trim() || state.status === "sending"}
          className="ml-auto rounded-control bg-primary px-4 py-1.5 text-[15px] font-semibold text-on-primary transition-opacity disabled:opacity-40"
        >
          {button}
        </button>
      </div>
    </form>
  );
}

export function ActionButton({
  label,
  onAct,
  tone = "secondary",
}: {
  label: string;
  onAct: () => Promise<boolean>;
  tone?: "primary" | "secondary";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onAct();
        setBusy(false);
      }}
      className={`rounded-control px-3 py-1.5 text-[15px] font-semibold transition-[filter,opacity] hover:brightness-95 disabled:opacity-50 ${
        tone === "primary" ? "bg-primary text-on-primary" : "bg-button-2 text-ink"
      }`}
    >
      {label}
    </button>
  );
}
