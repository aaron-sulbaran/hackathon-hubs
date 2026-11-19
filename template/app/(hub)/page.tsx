import { BoardingPasses } from "@/components/BoardingPasses";
import { Departures } from "@/components/Departures";
import { DesignReviewRow } from "@/components/DesignReviews";
import { HubError } from "@/components/HubError";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { NeedsYou } from "@/components/NeedsYou";
import { OnboardingCard } from "@/components/OnboardingCard";
import { Greeting } from "@/components/Greeting";
import { getHub } from "@/lib/web/get-hub";
import { buildGraph } from "@/lib/web/graph";
import { isDesignReview } from "@/lib/web/design-reviews";
import { AGENT_PROMPT_FILE, inviteUrlFor, onboardingEntries } from "@/lib/web/onboarding";
import { nextFor } from "@/lib/web/next-up";
import { finalDeadline } from "@/lib/web/playbook";
import { designReviewSummary, mentorQuestionViews } from "@/lib/web/views";

export const dynamic = "force-dynamic";

// The home page is what a teammate needs on arrival, in this order on every
// width: the map of what we know, time left, what needs them, who is on what.
// The feed, the item board, and mentor questions have their own pages.

export default async function HomePage() {
  const { board, pages, agenda, agentPrompt, mentorOrder, nowIso, repo, error, configError } = await getHub();
  const { nodes, edges } = buildGraph(board, pages);
  const mentorIds = new Set(mentorQuestionViews(board, mentorOrder, repo).map((view) => view.question.id));
  const needsBoard = { decisions: board.decisions, gates: board.gates, questions: board.questions.filter((question) => !mentorIds.has(question.id) && !isDesignReview(question.title)) };
  const design = designReviewSummary(board);
  const onboarding = onboardingEntries(board.items, board.people.map((person) => person.id));
  const promptUrl = repo ? `https://github.com/${repo}/blob/main/${AGENT_PROMPT_FILE}` : null;
  const quiet = (title: string) => isDesignReview(title) || /^(mentor|sponsor|organizer) question:/i.test(title);
  const next = Object.fromEntries(board.people.map((person) => [person.id, nextFor(board, person.id, onboarding, Date.parse(nowIso), quiet)]));
  const deadline = finalDeadline(agenda);

  return (
    <main className="mx-auto grid max-w-[1000px] grid-cols-1 gap-4 px-3 pt-4 sm:px-4 xl:max-w-[1440px] xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-rows-[auto_auto_1fr] xl:items-start xl:gap-6">
      {/* Phone order is the reading order: map, time left, needs you, who is
          on what. From 1280px the map and the passes share the wide column. */}
      <div className="min-w-0 xl:col-span-2">
        <Greeting next={next} deadlineMs={deadline?.startMs ?? null} nowIso={nowIso} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:col-start-1 xl:row-start-2">
        {error && <HubError message={error} />}
        {configError && <HubError heading="hub.config.json has a problem" message={configError} />}
        <KnowledgeGraph nodes={nodes} edges={edges} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-[72px] xl:col-start-2 xl:row-span-2 xl:row-start-2">
        <Departures agenda={agenda} nowIso={nowIso} />
        <OnboardingCard entries={onboarding} prompt={agentPrompt} promptUrl={promptUrl} inviteUrl={inviteUrlFor(repo)} />
        <NeedsYou board={needsBoard} />
        {design.open > 0 && <DesignReviewRow open={design.open} comments={design.comments} />}
      </div>
      <div className="min-w-0 xl:col-start-1 xl:row-start-3">
        <BoardingPasses board={board} onboarding={onboarding} nowIso={nowIso} />
      </div>
    </main>
  );
}
