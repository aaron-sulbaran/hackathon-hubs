"use client";

import Link from "next/link";
import type { NextUp } from "@/lib/web/next-up";
import { countdownParts } from "@/lib/web/format";
import { firstName } from "@/lib/web/people";
import { Avatar } from "./Avatar";
import { useHub } from "./HubContext";
import { useNow } from "./useNow";
import { useHydrated } from "./useWho";

// The first line of the home page: hello by first name, the one thing to do
// next, and the time left to submit. It reveals left to right once, when the
// page first paints. Nobody picked on this device yet: the same line asks who
// you are, with one button per teammate.

export function Greeting({ next, deadlineMs, nowIso }: { next: Record<string, NextUp>; deadlineMs: number | null; nowIso: string }) {
  const { people, who, setWho } = useHub();
  const hydrated = useHydrated();
  const nowMs = useNow(nowIso);
  const parts = deadlineMs ? countdownParts(deadlineMs, nowMs) : null;
  const left = parts ? `${parts.days * 24 + parts.hours}h ${String(parts.minutes).padStart(2, "0")}m` : null;
  const person = people.find((candidate) => candidate.id === who);
  const up = who ? next[who] : undefined;

  const clock = left && (
    <p className="shrink-0 text-[13px] text-ink-2">
      <span className="text-[17px] font-semibold text-ink tabular-nums">{left}</span> left to submit
    </p>
  );

  if (!hydrated) return <section aria-label="Hello" className="min-h-[76px] rounded-card bg-card shadow-card" />;

  if (!person || !up) {
    return (
      <section aria-labelledby="hello" className="reveal-in rounded-card bg-card px-4 py-3 shadow-card sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="hello" className="text-[20px] font-semibold text-ink">
            Hi. Who are you?
          </h2>
          {clock}
        </div>
        <ul className="mt-2 flex flex-wrap gap-2">
          {people.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => setWho(candidate.id)}
                className="flex min-h-11 items-center gap-2 rounded-full bg-card-flat py-1 pr-4 pl-1.5 text-[15px] font-semibold text-ink transition-colors hover:bg-hover"
              >
                <Avatar id={candidate.id} name={candidate.name} size={32} />
                {firstName(candidate.name)}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[13px] text-ink-2">Once per device. It signs what you do here.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="hello" className="reveal-in rounded-card bg-card px-4 py-3 shadow-card sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <h2 id="hello" className="min-w-0 text-[20px] leading-snug font-semibold text-ink">
          Hi {firstName(person.name)}, next for you:{" "}
          <Link href={up.href} className="text-link underline decoration-2 underline-offset-4 hover:decoration-[3px]">
            {up.title}
          </Link>
        </h2>
        {clock}
      </div>
    </section>
  );
}
