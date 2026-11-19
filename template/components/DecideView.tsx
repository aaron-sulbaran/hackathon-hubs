"use client";

import { useId, useState } from "react";
import { useDraft } from "./useDraft";
import { formatStamp } from "@/lib/web/format";
import { firstName } from "@/lib/web/people";
import type { DecisionView, GateView, QuestionView } from "@/lib/web/views";
import { Avatar } from "./Avatar";
import { ActionButton, CommentBox } from "./CommentBox";
import { FeedCard } from "./FeedCard";
import { ActReceipt, useAct, useHub } from "./HubContext";
import { StatusGlyph } from "./StatusGlyph";
import { useNow } from "./useNow";

const GATE_WORDS = { open: "Open", proposed: "Ready for a yes", passed: "Passed", failed: "Failed" } as const;
const DECISION_WORDS = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" } as const;

function nameOf(people: Array<{ id: string; name: string }>, id: string): string {
  const person = people.find((candidate) => candidate.id === id);
  return person ? firstName(person.name) : id;
}

export function Byline({ id, at, verb }: { id: string; at: string; verb: string }) {
  const { people } = useHub();
  const person = people.find((candidate) => candidate.id === id);
  return (
    <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
      <Avatar id={id} name={person?.name ?? id} size={20} />
      <span>
        <span className="font-semibold text-ink">{person ? firstName(person.name) : id}</span> {verb} · {formatStamp(Date.parse(at))}
      </span>
    </p>
  );
}

export function DecisionCard({ view, nowIso }: { view: DecisionView; nowIso: string }) {
  const { decision } = view;
  const { act, state } = useAct();
  const nowMs = useNow(nowIso);
  const { people } = useHub();
  const resolvedBy = decision.resolved ? nameOf(people, decision.resolved.by) : null;
  return (
    <article id={decision.id} className="rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="pt-0.5">
          <StatusGlyph status={decision.status} size={22} label={DECISION_WORDS[decision.status]} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-snug font-semibold text-ink">{decision.title}</h3>
          <Byline id={decision.proposedBy} at={decision.proposedAt} verb="proposed" />
        </div>
      </div>
      {view.textHtml && <div className="prose-hub mt-2 text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: view.textHtml }} />}
      {decision.affects.length > 0 && <p className="mt-2 text-[13px] text-ink-2">Affects {decision.affects.join(", ")}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {decision.status === "proposed" ? (
          <>
            <ActionButton label="Accept" onAct={() => act({ type: "decision.accept", ref: decision.id, title: `Accepted: ${decision.title}`.slice(0, 140) })} />
            <ActionButton label="Reject" onAct={() => act({ type: "decision.reject", ref: decision.id, title: `Rejected: ${decision.title}`.slice(0, 140) })} />
          </>
        ) : (
          <p className="text-[14px] font-semibold text-ink">
            {DECISION_WORDS[decision.status]}
            {resolvedBy && decision.resolved ? ` by ${resolvedBy}, ${formatStamp(Date.parse(decision.resolved.at))}` : ""}
          </p>
        )}
        <ActReceipt state={state} />
      </div>
      <Thread entries={view.comments} nowMs={nowMs} />
      <div className="mt-3">
        <CommentBox refId={decision.id} rows={1} />
      </div>
    </article>
  );
}

export function GateCard({ view, nowIso }: { view: GateView; nowIso: string }) {
  const { gate } = view;
  const { act, state } = useAct();
  const nowMs = useNow(nowIso);
  const evidence = view.history.flatMap((entry) => (entry.event.type === "gate.propose" && Array.isArray(entry.event.data.evidence) ? (entry.event.data.evidence as unknown[]).map(String) : []));
  return (
    <article id={gate.id} className="rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="pt-0.5">
          <StatusGlyph status={gate.status} size={22} label={GATE_WORDS[gate.status]} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-snug font-semibold text-ink">{gate.title}</h3>
          <p className="text-[13px] text-ink-2">
            {GATE_WORDS[gate.status]}
            {gate.due ? ` · due ${formatStamp(Date.parse(gate.due))}` : ""}
          </p>
        </div>
      </div>
      {view.textHtml && <div className="prose-hub mt-2 text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: view.textHtml }} />}
      {gate.criteria.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold text-ink-2">Criteria</p>
          <ul className="mt-1 flex flex-col gap-1">
            {gate.criteria.map((criterion) => (
              <li key={criterion} className="flex items-start gap-2 text-[15px] text-ink">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink-2" aria-hidden="true" />
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
      {evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold text-ink-2">Evidence from the agent</p>
          <ul className="mt-1 flex flex-col gap-1 text-[14px]">
            {evidence.map((line) => (
              <li key={line} className="truncate">
                {/^https?:/.test(line) ? <a href={line} className="text-link hover:underline" target="_blank" rel="noopener noreferrer">{line}</a> : <span className="text-ink">{line}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gate.status === "open" || gate.status === "proposed" ? (
          <>
            <ActionButton label="Pass" tone={gate.status === "proposed" ? "primary" : "secondary"} onAct={() => act({ type: "gate.pass", ref: gate.id, title: `Passed: ${gate.title}`.slice(0, 140) })} />
            <ActionButton label="Fail" onAct={() => act({ type: "gate.fail", ref: gate.id, title: `Failed: ${gate.title}`.slice(0, 140) })} />
          </>
        ) : null}
        <ActReceipt state={state} />
      </div>
      {view.history.length > 1 && (
        <details className="mt-3 rounded-card bg-card-flat px-3 py-2">
          <summary className="cursor-pointer text-[14px] font-semibold text-ink">History ({view.history.length})</summary>
          <Thread entries={view.history} nowMs={nowMs} />
        </details>
      )}
      <Thread entries={view.comments} nowMs={nowMs} />
      <div className="mt-3">
        <CommentBox refId={gate.id} rows={1} />
      </div>
    </article>
  );
}

export function QuestionCard({ view, nowIso }: { view: QuestionView; nowIso: string }) {
  const { question } = view;
  const { people } = useHub();
  const nowMs = useNow(nowIso);
  const forName = question.for === "team" ? "the team" : firstName(people.find((person) => person.id === question.for)?.name ?? question.for);
  return (
    <article id={question.id} className="rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="pt-0.5">
          <StatusGlyph status={question.status} size={22} label={question.status === "settled" ? "Settled" : "Open"} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-snug font-semibold text-ink">{question.title}</h3>
          <Byline id={question.askedBy} at={question.askedAt} verb={`asked ${forName}`} />
        </div>
      </div>
      {view.textHtml && <div className="prose-hub mt-2 text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: view.textHtml }} />}
      {question.blocking && <p className="mt-2 text-[13px] text-ink-2">Blocking {question.blocking}</p>}
      {question.status === "settled" && question.answer && (
        <div className="mt-3 rounded-card bg-tint px-3 py-2">
          <p className="text-[13px] font-semibold text-primary">Settled answer{question.settled ? ` · ${nameOf(people, question.settled.by)}${question.settled.via === "agent" ? " (agent)" : ""}` : ""}</p>
          <p className="text-[15px] text-ink">{question.answer}</p>
        </div>
      )}
      {view.answers.length > 0 && (
        <div className="mt-3">
          <p className="text-[13px] font-semibold text-ink-2">Answers</p>
          <Thread entries={view.answers} nowMs={nowMs} />
        </div>
      )}
      {question.status === "open" && (
        <div className="mt-3 flex flex-col gap-3">
          <CommentBox refId={question.id} type="question.answer" label="Your answer" button="Answer" />
          <SettleForm questionId={question.id} questionTitle={question.title} suggestion={view.answers.at(-1)?.event.text ?? view.answers.at(-1)?.event.title ?? ""} />
        </div>
      )}
    </article>
  );
}

export function SettleForm({ questionId, questionTitle, suggestion }: { questionId: string; questionTitle: string; suggestion: string }) {
  const [open, setOpen] = useDraft(`settle-open:${questionId}`, false);
  const [answer, setAnswer] = useDraft(`settle:${questionId}`, suggestion);
  const { act, state } = useAct();
  const fieldId = useId();
  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)} className="rounded-control bg-button-2 px-3 py-1.5 text-[15px] font-semibold text-ink hover:brightness-95">
          Settle it
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-1.5 rounded-card bg-card-flat p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!answer.trim()) return;
        if (await act({ type: "question.settle", ref: questionId, title: `Settled: ${questionTitle}`.slice(0, 140), data: { answer: answer.trim() } })) setOpen(false);
      }}
    >
      <label htmlFor={fieldId} className="text-[13px] font-semibold text-ink-2">
        Final answer (closes the question)
      </label>
      <textarea id={fieldId} rows={2} value={answer} onChange={(event) => setAnswer(event.target.value)} className="w-full rounded-control bg-card px-3 py-2 text-[15px] text-ink focus:outline-2 focus:outline-primary" />
      <div className="flex items-center gap-2">
        <ActReceipt state={state} />
        <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-control px-3 py-1.5 text-[15px] font-semibold text-ink-2 hover:bg-hover">
          Cancel
        </button>
        <button type="submit" disabled={!answer.trim()} className="rounded-control bg-primary px-4 py-1.5 text-[15px] font-semibold text-on-primary disabled:opacity-40">
          Settle
        </button>
      </div>
    </form>
  );
}

export function Thread({ entries, nowMs }: { entries: Array<import("@/lib/web/entries").FeedEntry>; nowMs: number }) {
  if (entries.length === 0) return null;
  return (
    <ol className="mt-2 divide-y divide-hairline">
      {entries.map((entry) => (
        <li key={entry.event.id}>
          <FeedCard entry={entry} nowMs={nowMs} compact />
        </li>
      ))}
    </ol>
  );
}

export function AskQuestion() {
  const { people } = useHub();
  const { act, state } = useAct();
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("team");
  const titleId = useId();
  const forId = useId();
  return (
    <form
      className="flex flex-col gap-2 rounded-card bg-card p-3 shadow-card sm:flex-row sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        if (await act({ type: "question.ask", title: title.trim(), data: { for: target } })) setTitle("");
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={titleId} className="text-[13px] font-semibold text-ink-2">
          Ask a question
        </label>
        <input id={titleId} value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-control bg-card-flat px-3 py-2 text-[15px] text-ink focus:outline-2 focus:outline-primary" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={forId} className="text-[13px] font-semibold text-ink-2">
          For
        </label>
        <select id={forId} value={target} onChange={(event) => setTarget(event.target.value)} className="rounded-control bg-button-2 px-2 py-2 text-[15px] font-semibold text-ink">
          <option value="team">The team</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <ActReceipt state={state} />
        <button type="submit" disabled={!title.trim()} className="rounded-control bg-primary px-4 py-2 text-[15px] font-semibold text-on-primary disabled:opacity-40">
          Ask
        </button>
      </div>
    </form>
  );
}
