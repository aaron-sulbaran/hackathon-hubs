import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Card, Chip, EmptyState } from "@/components/Card";
import { FeedCard } from "@/components/FeedCard";
import { StatusGlyph } from "@/components/StatusGlyph";
import { LANE_LABEL } from "@/lib/web/lanes";
import { toEntries } from "@/lib/web/entries";
import { formatRelative, formatStamp } from "@/lib/web/format";
import { getHub } from "@/lib/web/get-hub";
import { accentFor, firstName, presenceOf } from "@/lib/web/people";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "items", label: "Open items" },
  { id: "questions", label: "Questions" },
  { id: "activity", label: "Activity" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.some((candidate) => candidate.id === tabParam) ? (tabParam as Tab) : "items";
  const { board, nowIso, repo } = await getHub();
  const person = board.people.find((candidate) => candidate.id === id);
  if (!person) notFound();
  const nowMs = Date.parse(nowIso);
  const presence = presenceOf(person, board.sessions);
  const session = board.sessions.find((candidate) => candidate.id === person.activeSession);
  const items = board.items.filter((item) => item.owner === person.id && item.lane !== "done");
  const questions = board.questions.filter((question) => question.askedBy === person.id || question.for === person.id);
  const sessions = board.sessions.filter((candidate) => candidate.by === person.id).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const activity = toEntries(board, board.activity.filter((event) => event.by === person.id && event.type !== "script.clock").slice(0, 60), repo);
  const counts: Record<Tab, number> = { items: items.length, questions: questions.length, activity: activity.length };
  const name = firstName(person.name);

  return (
    <main className="mx-auto flex max-w-[860px] flex-col gap-4 px-2 pt-4 sm:px-4">
      <Card className="overflow-hidden">
        <div className="h-24 sm:h-32" style={{ background: `color-mix(in srgb, ${accentFor(person.id).fill} 22%, var(--card))` }} aria-hidden="true" />
        <div className="flex flex-col gap-3 px-4 pb-0 sm:flex-row sm:items-end sm:gap-4">
          <div className="-mt-12 shrink-0 rounded-full bg-card p-1 sm:-mt-16">
            <Avatar id={person.id} name={person.name} size={112} presence={presence} />
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <h1 className="text-[28px] leading-tight font-semibold text-ink">{person.name}</h1>
            <p className="text-[15px] text-ink-2">
              {[person.school, person.focus].filter(Boolean).join(" · ")}
              {person.github && (
                <>
                  {" · "}
                  <a href={`https://github.com/${person.github}`} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                    github.com/{person.github}
                  </a>
                </>
              )}
            </p>
            <p className="mt-1 text-[14px] text-ink">
              {presence === "active" && session ? (
                <>
                  <span className="font-semibold text-primary">Working now</span> on {session.focus}
                  {session.agent ? ` with ${session.agent}` : ""}
                </>
              ) : presence === "idle" && session ? (
                <>
                  <span className="font-semibold">Idle</span> in a session on {session.focus}
                </>
              ) : person.lastSeenAt ? (
                <>Last posted {formatRelative(person.lastSeenAt, nowMs)}</>
              ) : (
                <>No posts yet</>
              )}
            </p>
          </div>
        </div>
        <nav aria-label={`${name}'s tabs`} className="no-scrollbar mt-2 flex overflow-x-auto border-t border-hairline px-2">
          {TABS.map((candidate) => {
            const active = candidate.id === tab;
            return (
              <Link
                key={candidate.id}
                href={`/p/${person.id}?tab=${candidate.id}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`relative shrink-0 px-3 py-3.5 text-[15px] font-semibold ${active ? "text-primary" : "text-ink-2 hover:text-ink"}`}
              >
                {candidate.label} <span className="font-normal tabular-nums">{counts[candidate.id]}</span>
                <span className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-[2px] bg-primary transition-transform duration-300 ${active ? "scale-x-100" : "scale-x-0"}`} aria-hidden="true" />
              </Link>
            );
          })}
        </nav>
      </Card>

      {tab === "items" && (
        <Card>
          {items.length === 0 ? (
            <EmptyState title={`${name} has no open items`}>Items {name} claims or owns show up here until they are done.</EmptyState>
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={`/board?item=${item.id}`} className="flex flex-wrap items-center gap-2 px-4 py-3 hover:bg-hover">
                    <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{item.title}</span>
                    <Chip tone={item.lane === "needs_human" ? "primary" : "neutral"}>{LANE_LABEL[item.lane]}</Chip>
                    <span className="text-[12px] text-ink-2">updated {formatRelative(item.updatedAt, nowMs)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "questions" && (
        <Card>
          {questions.length === 0 ? (
            <EmptyState title="No questions">Questions {name} asks, and questions asked of {name}, show up here.</EmptyState>
          ) : (
            <ul className="divide-y divide-hairline">
              {questions.map((question) => (
                <li key={question.id}>
                  <Link href={`/decide#${question.id}`} className="flex items-start gap-2.5 px-4 py-3 hover:bg-hover">
                    <span className="pt-0.5">
                      <StatusGlyph status={question.status} label={question.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ink">{question.title}</span>
                      <span className="block text-[12px] text-ink-2">
                        {question.askedBy === person.id ? `Asked by ${name}` : `Asked of ${name}`} · {question.status === "settled" ? "settled" : `${question.answers.length} answer${question.answers.length === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "activity" && (
        <>
          <Card>
            <h2 className="px-4 pt-3 text-[17px] font-semibold text-ink">Sessions</h2>
            {sessions.length === 0 ? (
              <EmptyState title="No sessions yet">Each agent session {name} starts (./hub start) is listed here with its summary when it ends.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {sessions.map((candidate) => (
                  <li key={candidate.id} className="px-4 py-3">
                    <p className="text-[15px] font-semibold text-ink">{candidate.focus}</p>
                    <p className="text-[12px] text-ink-2">
                      {candidate.agent ?? "agent"} · {formatStamp(Date.parse(candidate.startedAt))}
                      {candidate.endedAt ? ` to ${formatStamp(Date.parse(candidate.endedAt))}` : candidate.idle ? " · idle" : " · live"}
                    </p>
                    {candidate.summary && <p className="mt-1 text-[14px] whitespace-pre-line text-ink">{candidate.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {activity.length === 0 ? (
            <Card>
              <EmptyState title="No activity yet">Everything {name} and their agents post appears here, newest first.</EmptyState>
            </Card>
          ) : (
            activity.map((entry) => <FeedCard key={entry.event.id} entry={entry} nowMs={nowMs} />)
          )}
        </>
      )}
    </main>
  );
}
