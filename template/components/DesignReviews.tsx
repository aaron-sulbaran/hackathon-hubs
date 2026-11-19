"use client";

import Link from "next/link";
import { useEffect, useId } from "react";
import { firstName } from "@/lib/web/people";
import type { DesignReviewView } from "@/lib/web/views";
import { EmptyState } from "./Card";
import { CommentBox } from "./CommentBox";
import { Byline, Thread } from "./DecideView";
import { ActReceipt, useAct, useHub } from "./HubContext";
import { ChevronDownIcon, DesignIcon } from "./icons";
import { StatusGlyph } from "./StatusGlyph";
import { useDraft } from "./useDraft";
import { useNow } from "./useNow";

// The Design page: each "Design review:" question as one card with its images
// large, the team's feedback (the question's answers), and a box to add more.
// Resolved reviews fold into muted rows at the bottom that still open.

export const POST_COMMAND = './hub design <image-file> "<title>" -m "<what to look at>"';

function commentWords(count: number): string {
  if (count === 0) return "No feedback yet";
  return count === 1 ? "1 comment" : `${count} comments`;
}

export function DesignReviews({ reviews, nowIso }: { reviews: DesignReviewView[]; nowIso: string }) {
  // Opened resolved rows are remembered for this tab, so a refresh keeps them open.
  const [openIds, setOpenIds] = useDraft<string[]>("open-design-reviews", []);
  const ids = reviews.map((view) => view.question.id).join(" ");

  // A link to #q-xxxx opens that card (if it was folded) and scrolls to it.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!target || !ids.split(" ").includes(target)) return;
    if (!openIds.includes(target)) setOpenIds([...openIds, target]);
    const frame = window.requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
    // Runs when the set of reviews changes, not on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (reviews.length === 0) {
    return (
      <div className="rounded-card bg-card shadow-card">
        <EmptyState title="No design reviews yet">
          To ask the team about a screenshot or mockup, run <code className="rounded-[4px] bg-card-flat px-1 py-0.5 text-[12px] break-all text-ink">{POST_COMMAND}</code> from the hub. It shows up here as a card the team can comment on.
        </EmptyState>
      </div>
    );
  }

  const open = reviews.filter((view) => view.question.status !== "settled");
  const resolved = reviews.filter((view) => view.question.status === "settled");

  function toggle(id: string) {
    setOpenIds(openIds.includes(id) ? openIds.filter((value) => value !== id) : [...openIds, id]);
  }

  return (
    <div className="flex flex-col gap-4">
      {open.map((view) => (
        <ReviewCard key={view.question.id} view={view} nowIso={nowIso} />
      ))}
      {open.length === 0 && (
        <div className="rounded-card bg-card shadow-card">
          <EmptyState title="Nothing open">Every review is resolved. Post a new one with {POST_COMMAND}.</EmptyState>
        </div>
      )}
      {resolved.length > 0 && (
        <section aria-label="Resolved" className="flex flex-col gap-2">
          <h2 className="px-1 pt-2 text-[13px] font-semibold text-ink-2">Resolved ({resolved.length})</h2>
          {resolved.map((view) => (
            <ResolvedRow key={view.question.id} view={view} nowIso={nowIso} open={openIds.includes(view.question.id)} onToggle={toggle} />
          ))}
        </section>
      )}
    </div>
  );
}

function feedbackOf(view: DesignReviewView) {
  return [...view.answers, ...view.comments].sort((a, b) => a.event.at.localeCompare(b.event.at));
}

function ReviewBody({ view, nowIso }: { view: DesignReviewView; nowIso: string }) {
  const nowMs = useNow(nowIso);
  const feedback = feedbackOf(view);
  return (
    <>
      {view.textHtml && <div className="prose-hub mt-3 text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: view.textHtml }} />}
      <div className="mt-4 border-t border-hairline pt-3">
        <h3 className="text-[13px] font-semibold text-ink-2">Feedback{feedback.length > 0 ? ` (${feedback.length})` : ""}</h3>
        {feedback.length === 0 && view.question.status !== "settled" && <p className="mt-1 text-[13px] text-ink-2">Nobody has commented yet.</p>}
        <Thread entries={feedback} nowMs={nowMs} />
      </div>
    </>
  );
}

function ReviewCard({ view, nowIso }: { view: DesignReviewView; nowIso: string }) {
  const { question } = view;
  const { people } = useHub();
  const forName = question.for === "team" ? "the team" : firstName(people.find((person) => person.id === question.for)?.name ?? question.for);
  return (
    <article id={question.id} className="scroll-mt-[72px] rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="pt-1">
          <StatusGlyph status={question.answers.length > 0 ? "proposed" : "open"} size={20} label={question.answers.length > 0 ? "Has feedback" : "Open"} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] leading-snug font-semibold text-ink">{view.heading}</h2>
          <Byline id={question.askedBy} at={question.askedAt} verb={`posted for ${forName}`} />
        </div>
      </div>
      <ReviewBody view={view} nowIso={nowIso} />
      <div className="mt-3 flex flex-col gap-2">
        <CommentBox
          refId={question.id}
          type="question.answer"
          label="What should change"
          button="Add feedback"
          rows={3}
          placeholder="Be specific: which part, and what you would do instead"
        />
        <ResolveButton questionId={question.id} questionTitle={question.title} />
      </div>
    </article>
  );
}

function ResolveButton({ questionId, questionTitle }: { questionId: string; questionTitle: string }) {
  const { act, state } = useAct();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state.status === "sending"}
        onClick={() => act({ type: "question.settle", ref: questionId, title: `Settled: ${questionTitle}`.slice(0, 140), data: { answer: "Resolved on the Design page." } })}
        className="-ml-2 flex min-h-11 items-center rounded-control px-2 text-[14px] font-semibold text-ink-2 hover:bg-hover disabled:opacity-50"
      >
        Mark resolved
      </button>
      <ActReceipt state={state} />
    </div>
  );
}

function ResolvedRow({ view, nowIso, open, onToggle }: { view: DesignReviewView; nowIso: string; open: boolean; onToggle: (id: string) => void }) {
  const { question } = view;
  const panelId = useId();
  const count = feedbackOf(view).length;
  return (
    <article id={question.id} className="scroll-mt-[72px] rounded-card bg-card shadow-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(question.id)}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-card px-4 py-2.5 text-left hover:bg-hover"
      >
        <StatusGlyph status="settled" size={16} label="Resolved" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-ink-2">{view.heading}</span>
          <span className="block text-[12px] text-ink-2">Resolved · {commentWords(count)}</span>
        </span>
        <ChevronDownIcon size={18} className={`shrink-0 text-ink-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="animate-fade-in px-4 pb-4">
          <Byline id={question.askedBy} at={question.askedAt} verb="posted" />
          <ReviewBody view={view} nowIso={nowIso} />
        </div>
      )}
    </article>
  );
}

/** The home page's one row: how many reviews are open and how much feedback they have. */
export function DesignReviewRow({ open, comments }: { open: number; comments: number }) {
  const summary = open === 0 ? "None open. Post a screenshot or mockup for feedback." : `${open === 1 ? "1 open" : `${open} open`} · ${commentWords(comments).toLowerCase()}`;
  return (
    <Link href="/design" className="flex min-h-12 items-center gap-3 rounded-card bg-card px-4 py-2.5 shadow-card hover:bg-hover">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-button-2 text-ink">
        <DesignIcon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-semibold text-ink">Design reviews</span>
        <span className="block text-[13px] text-ink-2 tabular-nums">{summary}</span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold text-link">Open Design</span>
    </Link>
  );
}
