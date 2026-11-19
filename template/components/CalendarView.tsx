"use client";

import { dayKey, formatDay, formatTime } from "@/lib/web/format";
import type { AgendaEntry } from "@/lib/web/playbook";
import { EmptyState } from "./Card";
import { useNow } from "./useNow";

// The schedule as an itinerary, one card per day: times down the left, a
// dashed route with a stop for each entry, the room beside the title. A stop's
// shape says what it is: a ring for something that happens, a filled diamond
// for a deadline, an outlined diamond for a checkpoint. Past stops dim; a Now
// marker sits between the last stop passed and the next.

function Stop({ entry }: { entry: AgendaEntry }) {
  if (entry.source === "gate") return <span className="mt-[5px] block h-3 w-3 rotate-45 border-2 border-primary bg-card" aria-label="Checkpoint" role="img" />;
  if (entry.point) return <span className="mt-[5px] block h-3 w-3 rotate-45 bg-primary" aria-label="Deadline" role="img" />;
  return <span className="mt-[4px] block h-3.5 w-3.5 rounded-full border-2 border-ink-2 bg-card" aria-hidden="true" />;
}

export function CalendarView({ agenda, nowIso }: { agenda: AgendaEntry[]; nowIso: string }) {
  const nowMs = useNow(nowIso);
  if (agenda.length === 0) {
    return (
      <div className="rounded-card bg-card shadow-card">
        <EmptyState title="No schedule yet">The schedule reads kb/playbook.md: one line per entry under Deadlines and Calendar. Checkpoints with a due time join it.</EmptyState>
      </div>
    );
  }
  const days = [...new Set(agenda.map((entry) => dayKey(entry.startMs)))];
  const today = dayKey(nowMs);
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const dayEntries = agenda.filter((entry) => dayKey(entry.startMs) === day);
        const nowIndex = today === day ? dayEntries.findIndex((entry) => entry.startMs > nowMs) : -2;
        return (
          <section key={day} aria-labelledby={`day-${day}`} className="rounded-card bg-card shadow-card">
            <h2 id={`day-${day}`} className="flex items-baseline gap-2 px-4 pt-4 pb-2 text-[17px] font-semibold text-ink sm:px-5">
              {formatDay(dayEntries[0]!.startMs)}
              {today === day && <span className="rounded-full bg-tint px-2 py-0.5 text-[12px] font-semibold">Today</span>}
            </h2>
            <ol className="px-4 pb-3 sm:px-5">
              {dayEntries.map((entry, index) => {
                const past = entry.endMs <= nowMs;
                return (
                  <li key={entry.id}>
                    {index === nowIndex && <NowMarker />}
                    <div className={`grid grid-cols-[64px_14px_minmax(0,1fr)] gap-x-3 ${past ? "opacity-55" : ""}`}>
                      <span className="pt-1.5 text-[13px] text-ink-2 tabular-nums">{formatTime(entry.startMs)}</span>
                      <span className="relative flex justify-center pt-1">
                        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 border-l-[1.5px] border-dashed border-divider" aria-hidden="true" />
                        <span className="relative">
                          <Stop entry={entry} />
                        </span>
                      </span>
                      <span className="min-w-0 py-1.5">
                        <span className={`block text-[15px] leading-snug text-ink ${entry.point ? "font-semibold" : ""}`}>{entry.title}</span>
                        <span className="block text-[13px] text-ink-2">
                          {entry.where ?? (entry.source === "gate" ? "checkpoint" : entry.kind)}
                          {!entry.point ? `, until ${formatTime(entry.endMs)}` : ""}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
              {nowIndex === -1 && <NowMarker />}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function NowMarker() {
  return (
    <div className="grid grid-cols-[64px_14px_minmax(0,1fr)] items-center gap-x-3 py-1" role="separator" aria-label="Now">
      <span className="text-[13px] font-semibold text-ink">Now</span>
      <span className="flex justify-center">
        <span className="block h-2.5 w-2.5 rounded-full bg-ink" />
      </span>
      <span className="h-[1.5px] bg-ink" />
    </div>
  );
}
