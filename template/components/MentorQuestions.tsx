"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { MENTOR_LIST_TITLE, MENTOR_QUESTIONS_SLUG, listStartsOpen, type ListChoice } from "@/lib/web/mentor-questions";
import { firstName } from "@/lib/web/people";
import type { MentorQuestionView } from "@/lib/web/views";
import { Chip } from "./Card";
import { CommentBox } from "./CommentBox";
import { SettleForm, Thread } from "./DecideView";
import { useHub } from "./HubContext";
import { ChevronDownIcon } from "./icons";
import { StatusGlyph } from "./StatusGlyph";
import { useDraft } from "./useDraft";
import { useNow } from "./useNow";

// Every question the team wants to put to a mentor or an organizer, as one
// numbered list to read off a phone. Tap a row for its answers and a box to
// add what the mentor said. Order comes from kb/mentor-questions.md, with the
// ones still to ask first. The list folds under its heading: open while
// something is left to ask, one line once everything is answered. A tap on
// the heading is remembered in this browser until the count to ask changes.

const LIST_CHOICE_KEY = "hub-mentor-list";

function readListChoice(): unknown {
  try {
    const saved = window.localStorage.getItem(LIST_CHOICE_KEY);
    return saved === null ? null : (JSON.parse(saved) as unknown);
  } catch {
    return null;
  }
}

function saveListChoice(choice: ListChoice) {
  try {
    window.localStorage.setItem(LIST_CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Private mode or storage full: the choice lasts for this page only.
  }
}

function answerWords(count: number): string {
  if (count === 0) return "No answers yet";
  return count === 1 ? "1 answer" : `${count} answers`;
}

export function MentorQuestions({
  rows,
  nowIso,
  allowSettle = false,
}: {
  rows: MentorQuestionView[];
  nowIso: string;
  /** Show "Settle it" in an open row (the Decide page). */
  allowSettle?: boolean;
}) {
  const toAsk = rows.filter((row) => row.question.status === "open").length;
  const answered = rows.length - toAsk;
  // The server and the first render use the default, so the HTML matches; the
  // remembered choice and any #q-xxxx link apply right after.
  const [listOpen, setListOpen] = useState(() => listStartsOpen(toAsk, null));
  // Open rows are remembered for this tab, so a refresh never closes the one being answered.
  const [openIds, setOpenIds] = useDraft<string[]>("open-questions", []);
  const expanded = new Set(openIds);
  const headingId = useId();
  const listId = useId();
  const rowIds = rows.map((row) => row.question.id).join(" ");

  // Settle the list's state whenever the questions change: a link to #q-xxxx
  // opens the list and that row; otherwise the remembered choice or the default.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target && rowIds.split(" ").includes(target)) {
      setListOpen(true);
      setOpenIds([...new Set([...openIds, target])]);
      return;
    }
    setListOpen(listStartsOpen(toAsk, readListChoice()));
    // Runs when the questions change, not on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds, toAsk]);

  if (rows.length === 0) return null;

  function toggleList() {
    const next = !listOpen;
    setListOpen(next);
    saveListChoice({ open: next, toAsk });
  }

  function toggle(id: string) {
    setOpenIds(openIds.includes(id) ? openIds.filter((open) => open !== id) : [...openIds, id]);
  }

  return (
    <section id="mentor-questions" aria-labelledby={headingId} className="rounded-card bg-card shadow-card">
      <div className={`flex items-center justify-between gap-1 px-2 ${listOpen ? "pt-2" : "py-1.5"}`}>
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={toggleList}
            className="flex min-h-11 w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left hover:bg-hover sm:gap-2 sm:px-2"
          >
            <ChevronDownIcon size={18} className={`shrink-0 text-ink-2 transition-transform duration-200 ${listOpen ? "" : "-rotate-90"}`} />
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
              <span className="max-w-full truncate text-[17px] leading-tight font-semibold text-ink">{MENTOR_LIST_TITLE}</span>
              <span className="text-[13px] leading-tight text-ink-2 tabular-nums">
                <span aria-hidden="true" className="hidden sm:inline">
                  ·{" "}
                </span>
                <span className={toAsk > 0 ? "font-semibold text-primary" : ""}>{toAsk} to ask</span>
                {answered > 0 && ` · ${answered} answered`}
              </span>
            </span>
          </button>
        </h2>
        <Link href={`/kb/${MENTOR_QUESTIONS_SLUG}`} className="flex min-h-11 shrink-0 items-center rounded-control px-1.5 text-[13px] font-semibold text-link hover:underline sm:px-2">
          Open as a page
        </Link>
      </div>
      <ol id={listId} hidden={!listOpen} className="px-2 pb-2">
        {rows.map((row, index) => (
          <Row key={row.question.id} row={row} number={index + 1} open={expanded.has(row.question.id)} onToggle={toggle} nowIso={nowIso} allowSettle={allowSettle} />
        ))}
      </ol>
    </section>
  );
}

function Row({
  row,
  number,
  open,
  onToggle,
  nowIso,
  allowSettle,
}: {
  row: MentorQuestionView;
  number: number;
  open: boolean;
  onToggle: (id: string) => void;
  nowIso: string;
  allowSettle: boolean;
}) {
  const { question, answers } = row;
  const { people } = useHub();
  const nowMs = useNow(nowIso);
  const panelId = useId();
  const settled = question.status === "settled";
  // Shape first: hollow ring with nothing yet, half filled once someone has
  // posted an answer, filled disc with a check when the question is settled.
  const glyph = settled ? "settled" : answers.length > 0 ? "proposed" : "open";
  const state = settled ? "Answered" : answerWords(answers.length);
  const settledBy = question.settled ? firstName(people.find((person) => person.id === question.settled?.by)?.name ?? question.settled.by) : null;

  return (
    <li id={question.id} className="rounded-control">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(question.id)}
        className="flex min-h-12 w-full items-start gap-2.5 rounded-control px-2 py-2.5 text-left hover:bg-hover"
      >
        <span aria-hidden="true" className="w-6 shrink-0 pt-px text-right text-[15px] leading-snug font-semibold text-ink-2 tabular-nums">
          {number}
        </span>
        <span className="sr-only">Question {number}: </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-[16px] leading-snug ${settled ? "text-ink-2" : "font-semibold text-ink"}`}>{row.ask}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-2">
            <span aria-hidden="true" className="inline-flex">
              <StatusGlyph status={glyph} size={14} />
            </span>
            <span className={!settled && answers.length > 0 ? "font-semibold text-primary" : ""}>{state}</span>
            {row.kind === "organizer" && <Chip>Organizer</Chip>}
          </span>
        </span>
        <ChevronDownIcon size={18} className={`mt-0.5 shrink-0 text-ink-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="animate-fade-in pr-2 pb-3 pl-[42px]">
          {row.textHtml && <div className="prose-hub text-[14px] text-ink" dangerouslySetInnerHTML={{ __html: row.textHtml }} />}
          {settled && question.answer && (
            <div className="mt-1 rounded-card bg-tint px-3 py-2">
              <p className="text-[13px] font-semibold text-primary">Settled answer{settledBy ? ` · ${settledBy}` : ""}</p>
              <p className="text-[15px] text-ink">{question.answer}</p>
            </div>
          )}
          <Thread entries={answers} nowMs={nowMs} />
          {!settled && (
            <div className="mt-2 flex flex-col gap-3">
              <CommentBox refId={question.id} type="question.answer" label="What a mentor said" button="Add answer" placeholder="Mentor name: what they said" />
              {allowSettle && <SettleForm questionId={question.id} questionTitle={question.title} suggestion={answers.at(-1)?.event.text ?? answers.at(-1)?.event.title ?? ""} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
