import Link from "next/link";
import { formatRelative } from "@/lib/web/format";
import type { OnboardingEntry } from "@/lib/web/onboarding";
import { firstName, presenceOf } from "@/lib/web/people";
import { latestPulses, overlapsOf, safePrUrl, topFolders, type Pulse } from "@/lib/web/pulses";
import type { Board, Person, Session } from "@/lib/web/types";
import { Avatar } from "./Avatar";
import { BranchIcon, OverlapIcon } from "./icons";
import { StatusGlyph } from "./StatusGlyph";

// Who is on what, one boarding pass per teammate. The main part says what they
// are working on (open session focus, else their latest pulse, else their item
// in flight) with the branch, files and PR from the pulse. The stub says
// whether they are here: the avatar ring is the shape (solid working, dashed
// idle, none away) and the word repeats it. File overlaps sit above the passes.

const PULSE_SHOWN_HOURS = 12;

function ago(iso: string, nowMs: number): string {
  const relative = formatRelative(iso, nowMs);
  return /^\d+[mh]$/.test(relative) ? `${relative} ago` : relative;
}
const PRESENCE_WORDS = { active: "Working now", idle: "Idle", away: "Away" } as const;

function workOf(person: Person, board: Board, session: Session | undefined, pulse: Pulse | undefined) {
  const item = board.items.find((candidate) => candidate.owner === person.id && candidate.lane === "in_flight");
  const pulseItem = pulse?.item ? board.items.find((candidate) => candidate.id === pulse.item) : undefined;
  return session?.focus ?? pulse?.note ?? pulseItem?.title ?? item?.title ?? null;
}

export function BoardingPasses({ board, onboarding = [], nowIso }: { board: Board; onboarding?: OnboardingEntry[]; nowIso: string }) {
  const nowMs = Date.parse(nowIso);
  const nameOf = (id: string) => firstName(board.people.find((person) => person.id === id)?.name ?? id);
  const overlaps = overlapsOf(board);
  const pulses = latestPulses(board).filter((pulse) => nowMs - Date.parse(pulse.at) < PULSE_SHOWN_HOURS * 3600 * 1000);
  const connected = onboarding.filter((entry) => entry.done).length;

  return (
    <section aria-labelledby="passes-heading" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="passes-heading" className="text-[17px] font-semibold text-ink">
          Who is on what
        </h2>
        {onboarding.length > 0 && (
          <p className="text-[13px] text-ink-2 tabular-nums">
            {connected} of {onboarding.length} agents connected
          </p>
        )}
      </div>

      {overlaps.length > 0 && (
        <div role="note" className="rounded-card bg-card px-4 py-3 text-[13px] text-ink shadow-card">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <OverlapIcon size={18} />
            Same file in two people&apos;s hands
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {overlaps.slice(0, 6).map((overlap) => (
              <li key={`${overlap.repo}:${overlap.file}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <code className="min-w-0 truncate font-mono text-[12px]">{overlap.file}</code>
                <span className="text-ink-2">{overlap.people.map(nameOf).join(" and ")}</span>
              </li>
            ))}
          </ul>
          {overlaps.length > 6 && <p className="mt-1 text-[12px] text-ink-2">and {overlaps.length - 6} more; run ./hub who</p>}
        </div>
      )}

      <ul className="flex flex-col gap-2.5">
        {board.people.map((person) => {
          const presence = presenceOf(person, board.sessions);
          const session = board.sessions.find((candidate) => candidate.id === person.activeSession);
          const pulse = pulses.find((candidate) => candidate.by === person.id);
          const work = workOf(person, board, session, pulse);
          const prUrl = pulse?.pr ? safePrUrl(pulse.pr.url) : null;
          const folders = pulse ? topFolders(pulse.files) : [];
          const entry = onboarding.find((candidate) => candidate.owner === person.id);
          const agent = session?.agent ?? pulse?.agent ?? null;
          return (
            <li key={person.id} className="flex overflow-hidden rounded-card bg-card shadow-card">
              <Link href={`/p/${person.id}`} className="flex min-w-0 flex-1 gap-3 px-4 py-3 hover:bg-hover">
                <Avatar id={person.id} name={person.name} size={36} presence={presence} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">{person.name}</p>
                  <p className={`mt-0.5 text-[14px] leading-snug ${work ? "text-ink" : "text-ink-2"}`}>{work ?? "Nothing posted yet"}</p>
                  {pulse && (
                    <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <BranchIcon size={14} className="shrink-0" />
                        <code className="truncate font-mono text-ink">{pulse.branch ?? "detached"}</code>
                      </span>
                      <span>{pulse.pushed ? "pushed" : "not pushed"}</span>
                      {pulse.pr && <span className="font-semibold text-ink">PR #{pulse.pr.number}</span>}
                      <span>
                        {pulse.files.length} file{pulse.files.length === 1 ? "" : "s"}
                        {folders.length > 0 ? ` in ${folders.join(", ")}` : ""}
                      </span>
                      {pulse.behind > 0 && <span>{pulse.behind} behind main</span>}
                    </p>
                  )}
                  {prUrl && <span className="sr-only">Pull request at {prUrl}</span>}
                </div>
              </Link>
              <div className="flex w-[96px] shrink-0 flex-col justify-center gap-1 border-l-[1.5px] border-dashed border-divider px-3 py-3 text-[12px] leading-tight text-ink-2 sm:w-[112px]">
                <span className={`text-[13px] font-semibold ${presence === "away" ? "text-ink-2" : "text-ink"}`}>{PRESENCE_WORDS[presence]}</span>
                {agent && presence !== "away" && <span className="truncate">{agent}</span>}
                {person.lastSeenAt && <span>Last post {ago(person.lastSeenAt, nowMs)}</span>}
                {entry && (
                  <span className="mt-0.5 inline-flex items-center gap-1">
                    <StatusGlyph status={entry.done ? "done" : "open"} size={13} label={entry.done ? "Agent connected" : "Agent not connected yet"} />
                    {entry.done ? "Agent on" : "No agent"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
