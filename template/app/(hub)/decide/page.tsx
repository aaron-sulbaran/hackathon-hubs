import type { ReactNode } from "react";
import { EmptyState } from "@/components/Card";
import { AskQuestion, DecisionCard, GateCard, QuestionCard } from "@/components/DecideView";
import { HubError } from "@/components/HubError";
import { MentorQuestions } from "@/components/MentorQuestions";
import { isDesignReview } from "@/lib/web/design-reviews";
import { getHub } from "@/lib/web/get-hub";
import { decisionViews, gateViews, mentorQuestionViews, questionViews } from "@/lib/web/views";

export const dynamic = "force-dynamic";

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[20px] font-semibold text-ink">{title}</h2>
        <span className="text-[13px] text-ink-2 tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  );
}

export default async function DecidePage() {
  const { board, mentorOrder, nowIso, repo, error } = await getHub();
  const decisions = decisionViews(board, repo);
  const gates = gateViews(board, repo);
  // Mentor and organizer questions fold into one list, and design reviews live on
  // the Design page; every other question keeps its own card.
  const mentorQuestions = mentorQuestionViews(board, mentorOrder, repo);
  const mentorIds = new Set(mentorQuestions.map((view) => view.question.id));
  const mentorOpen = mentorQuestions.filter((view) => view.question.status === "open").length;
  const questions = questionViews(board, repo).filter((view) => !mentorIds.has(view.question.id) && !isDesignReview(view.question.title));
  const proposed = decisions.filter((view) => view.decision.status === "proposed");
  const resolved = decisions.filter((view) => view.decision.status !== "proposed");
  const openQuestions = questions.filter((view) => view.question.status === "open");
  const settled = questions.filter((view) => view.question.status === "settled");
  const gateOrder = { proposed: 0, open: 1, failed: 2, passed: 3 } as const;
  gates.sort((a, b) => gateOrder[a.gate.status] - gateOrder[b.gate.status]);

  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-8 px-2 pt-4 sm:px-4">
      <div className="px-1">
        <h1 className="text-[24px] font-semibold text-ink">Decide</h1>
        <p className="text-[15px] text-ink-2">Agents decide and record; people may accept, reject, pass, and fail. Answers and settles work from here too.</p>
      </div>
      {error && <HubError message={error} />}

      <Section id="decisions" title="Calls on record" count={proposed.length}>
        <p className="-mt-2 px-1 text-[14px] text-ink-2">Nothing here blocks anyone. Accept, or object, if you want to.</p>
        {proposed.length === 0 ? (
          <div className="rounded-card bg-card shadow-card">
            <EmptyState title="No calls on record">When an agent records a big call (decision.propose), it appears here. Accepting or rejecting it is optional.</EmptyState>
          </div>
        ) : (
          proposed.map((view) => <DecisionCard key={view.decision.id} view={view} nowIso={nowIso} />)
        )}
      </Section>

      <Section id="gates" title="Gates" count={gates.length}>
        {gates.length === 0 ? (
          <div className="rounded-card bg-card shadow-card">
            <EmptyState title="No gates yet">A gate is a checkpoint with criteria (gate.add). An agent marks it ready; a person passes or fails it here.</EmptyState>
          </div>
        ) : (
          gates.map((view) => <GateCard key={view.gate.id} view={view} nowIso={nowIso} />)
        )}
      </Section>

      <Section id="questions" title="Open questions" count={openQuestions.length + mentorOpen}>
        <AskQuestion />
        <MentorQuestions rows={mentorQuestions} nowIso={nowIso} allowSettle />
        {openQuestions.length === 0 ? (
          mentorOpen > 0 ? null : (
            <div className="rounded-card bg-card shadow-card">
              <EmptyState title="No open questions">Questions from agents and people (question.ask) land here to be answered and settled.</EmptyState>
            </div>
          )
        ) : (
          openQuestions.map((view) => <QuestionCard key={view.question.id} view={view} nowIso={nowIso} />)
        )}
      </Section>

      {(settled.length > 0 || resolved.length > 0) && (
        <Section id="settled" title="Settled and resolved" count={settled.length + resolved.length}>
          {resolved.map((view) => (
            <DecisionCard key={view.decision.id} view={view} nowIso={nowIso} />
          ))}
          {settled.map((view) => (
            <QuestionCard key={view.question.id} view={view} nowIso={nowIso} />
          ))}
        </Section>
      )}
    </main>
  );
}
