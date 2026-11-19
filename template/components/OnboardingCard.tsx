"use client";

import { useEffect, useRef, useState } from "react";
import type { OnboardingEntry } from "@/lib/web/onboarding";
import { firstName } from "@/lib/web/people";
import { ActReceipt, useAct, useHub } from "./HubContext";
import { StatusGlyph } from "./StatusGlyph";
import { useHydrated } from "./useWho";

// The first thing a teammate sees after saying who they are: their one
// onboarding task, with the agent prompt one tap away. It stays until their
// onboarding item is done, from this card or from their agent's CLI.

const DONE_LINGER_MS = 2600;
const COPIED_LINGER_MS = 2400;

export function OnboardingCard({ entries, prompt, promptUrl, inviteUrl }: { entries: OnboardingEntry[]; prompt: string | null; promptUrl: string | null; inviteUrl: string }) {
  const { who } = useHub();
  const hydrated = useHydrated();
  if (!hydrated || !who) return null;
  const entry = entries.find((candidate) => candidate.owner === who);
  if (!entry) return null;
  return <FirstTask key={who} entry={entry} prompt={prompt} promptUrl={promptUrl} inviteUrl={inviteUrl} />;
}

type CopyState = "idle" | "copied" | "manual";

function FirstTask({ entry, prompt, promptUrl, inviteUrl }: { entry: OnboardingEntry; prompt: string | null; promptUrl: string | null; inviteUrl: string }) {
  const { people } = useHub();
  const { act, state } = useAct();
  const [phase, setPhase] = useState<"task" | "done" | "gone">("task");
  const [copy, setCopy] = useState<CopyState>("idle");
  const [promptOpen, setPromptOpen] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Clipboard refused or missing: open the prompt and select it, so one
  // keyboard copy finishes the job.
  useEffect(() => {
    if (copy === "manual" && promptOpen) {
      promptBox.current?.focus();
      promptBox.current?.select();
    }
  }, [copy, promptOpen]);

  if (phase === "gone" || (phase === "task" && entry.done)) return null;

  const name = firstName(people.find((person) => person.id === entry.owner)?.name ?? entry.owner);

  if (phase === "done") {
    return (
      <section aria-label="Your first task" className="animate-fade-in rounded-card bg-card p-4 shadow-card outline-2 -outline-offset-2 outline-primary">
        <p role="status" className="flex items-center gap-2.5 text-[17px] font-semibold text-ink">
          <StatusGlyph status="done" size={22} label="Done" />
          Done. Your agent is connected, {name}.
        </p>
      </section>
    );
  }

  async function copyPrompt() {
    if (!prompt) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) {
      setCopy("copied");
      timers.current.push(window.setTimeout(() => setCopy((current) => (current === "copied" ? "idle" : current)), COPIED_LINGER_MS));
    } else {
      setCopy("manual");
      setPromptOpen(true);
    }
  }

  async function markDone() {
    const saved = await act({ type: "item.done", ref: entry.itemId, title: `Done: ${entry.title}` });
    if (!saved) return;
    setPhase("done");
    timers.current.push(window.setTimeout(() => setPhase("gone"), DONE_LINGER_MS));
  }

  const sending = state.status === "sending";

  return (
    <section id="first-task" aria-labelledby="first-task-heading" className="animate-card-in rounded-card bg-card shadow-card outline-2 -outline-offset-2 outline-primary">
      <div className="px-4 pt-4">
        <p className="inline-block rounded-full bg-tint px-2 py-0.5 text-[12px] font-semibold text-primary">First task, {name}</p>
        <h2 id="first-task-heading" className="mt-1.5 text-[20px] leading-tight font-semibold text-ink">
          Your first task: connect your coding agent
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">About five minutes. After this your agent reads and writes the hub on its own.</p>
      </div>

      <ol className="mt-3 flex flex-col gap-3 px-4 text-[15px] leading-snug text-ink">
        <Step number={1}>
          <a href={inviteUrl} target="_blank" rel="noreferrer" className="font-semibold text-link hover:underline">
            Accept the GitHub invite
          </a>
          <span className="text-ink-2"> (opens GitHub).</span>
        </Step>
        <Step number={2}>
          Copy the prompt and paste it as the first message to your agent: Claude Code, Cursor, Codex, any of them.
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {prompt ? (
              <button
                type="button"
                onClick={copyPrompt}
                className="inline-flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-[15px] font-semibold text-on-primary transition-[filter] hover:brightness-95 active:brightness-90"
              >
                {copy === "copied" && (
                  <span aria-hidden="true" className="inline-flex">
                    <StatusGlyph status="done" size={18} />
                  </span>
                )}
                {copy === "copied" ? "Copied" : "Copy prompt"}
              </button>
            ) : (
              <span className="text-[13px] text-ink-2">
                The prompt could not be loaded here.{" "}
                {promptUrl && (
                  <a href={promptUrl} target="_blank" rel="noreferrer" className="font-semibold text-link hover:underline">
                    Open docs/agent-prompt.md
                  </a>
                )}
              </span>
            )}
            <span role="status" aria-live="polite" className="text-[13px] text-ink-2">
              {copy === "copied" && "Copied. Now paste it into your agent."}
              {copy === "manual" && "Copying is blocked in this browser. The prompt is selected below: copy it from there."}
            </span>
          </div>
          {prompt && (
            <details className="mt-2" open={promptOpen} onToggle={(event) => setPromptOpen(event.currentTarget.open)}>
              <summary className="w-fit cursor-pointer rounded-[4px] text-[13px] font-semibold text-link hover:underline">
                {promptOpen ? "Hide the prompt" : "Show the prompt"}
              </summary>
              <label htmlFor="agent-prompt-text" className="sr-only">
                The onboarding prompt, read only
              </label>
              <textarea
                id="agent-prompt-text"
                ref={promptBox}
                readOnly
                value={prompt}
                rows={10}
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 block w-full resize-y rounded-card bg-card-flat p-3 font-mono text-[12px] leading-relaxed text-ink"
              />
            </details>
          )}
          <p className="mt-2 text-[13px] text-ink-2">A cloud agent in the browser: save the token the hub owner sent you as a secret named HUB_GIT_TOKEN first.</p>
        </Step>
        <Step number={3}>When your agent prints its four line report, check this off.</Step>
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-divider px-4 py-3">
        <button
          type="button"
          onClick={markDone}
          disabled={sending}
          className="inline-flex h-10 items-center gap-2 rounded-control bg-button-2 px-4 text-[15px] font-semibold text-ink transition-[filter] hover:brightness-95 disabled:opacity-60"
        >
          <span aria-hidden="true" className="inline-flex">
            <StatusGlyph status="open" size={18} />
          </span>
          Mark done
        </button>
        <ActReceipt state={state} />
      </div>
    </section>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-[13px] font-semibold text-primary tabular-nums">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">Step {number}: </span>
        {children}
      </div>
    </li>
  );
}
