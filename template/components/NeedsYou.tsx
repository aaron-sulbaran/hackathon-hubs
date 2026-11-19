"use client";

import Link from "next/link";
import type { NeedsYou as NeedsYouData } from "@/lib/web/feed";
import { firstName } from "@/lib/web/people";
import type { Board } from "@/lib/web/types";
import { useHub, WritesOffNote } from "./HubContext";
import { StatusGlyph } from "./StatusGlyph";
import { useHydrated } from "./useWho";

// Questions asked of you or of the whole team: the one place a person acts.
// Calls on record are not listed here; they block nobody and live on Decide.

function needsFor(board: Pick<Board, "decisions" | "gates" | "questions">, who: string | null): NeedsYouData {
  return {
    gates: [],
    questions: board.questions.filter((question) => question.status === "open" && (question.for === who || question.for === "team")),
  };
}

export function NeedsYou({ board }: { board: Pick<Board, "decisions" | "gates" | "questions"> }) {
  const { who, people } = useHub();
  const hydrated = useHydrated();
  if (!hydrated || !who) return null;
  const needs = needsFor(board, who);
  const rows = [
    ...needs.gates.map((gate) => ({ id: gate.id, title: gate.title, status: "proposed", why: "Gate ready for a pass or fail" })),
    ...needs.questions.map((question) => ({
      id: question.id,
      title: question.title.replace(new RegExp(`^${firstName(people.find((p) => p.id === who)?.name ?? who)}:\\s*`, "i"), ""),
      status: "open",
      why: question.for === who ? `Asked of you by ${firstName(people.find((p) => p.id === question.askedBy)?.name ?? question.askedBy)}` : "Asked of the team",
    })),
  ];
  const name = firstName(people.find((person) => person.id === who)?.name ?? who);

  return (
    <section aria-label="Needs you" className="rounded-card bg-card shadow-card">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-1">
        <h2 className="text-[17px] font-semibold text-ink">Needs you, {name}</h2>
        {rows.length > 0 && <span className="rounded-full bg-rose px-2 py-0.5 text-[12px] font-semibold text-card tabular-nums">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-[13px] text-ink-2">Nothing waiting on you. Questions for you or the whole team land here.</p>
      ) : (
        <ul className="px-2 pb-2">
          {rows.slice(0, 6).map((row) => (
            <li key={row.id}>
              <Link href={`/decide#${row.id}`} className="flex items-start gap-2.5 rounded-control px-2 py-2 hover:bg-hover">
                <span className="pt-0.5">
                  <StatusGlyph status={row.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-snug font-semibold text-ink">{row.title}</span>
                  <span className="block text-[12px] text-ink-2">{row.why}</span>
                </span>
              </Link>
            </li>
          ))}
          {rows.length > 6 && (
            <li className="px-2 pt-1 text-[13px]">
              <Link href="/decide" className="font-semibold text-link hover:underline">
                {rows.length - 6} more on Decide
              </Link>
            </li>
          )}
        </ul>
      )}
      <WritesOffNote className="mx-4 mb-3" />
    </section>
  );
}
