"use client";

import { useMemo, useState } from "react";
import type { FeedEntry } from "@/lib/web/entries";
import { FEED_FILTERS, matchesFilter, type FeedFilter } from "@/lib/web/feed";
import { firstName } from "@/lib/web/people";
import { Avatar } from "./Avatar";
import { EmptyState } from "./Card";
import { FeedCard } from "./FeedCard";
import { useHub } from "./HubContext";
import { useNow } from "./useNow";

// The activity feed, newest first, filterable by person and by type. Posts that
// arrive on a live refresh open space for themselves and rise in; posts already
// on the page when it loaded never animate.

const PAGE = 40;

export function Feed({ entries, nowIso }: { entries: FeedEntry[]; nowIso: string }) {
  const { people } = useHub();
  const nowMs = useNow(nowIso);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [person, setPerson] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  // Ids on the page when it loaded never animate; anything that arrives later does, once, on mount.
  const [initialIds] = useState(() => new Set(entries.map((entry) => entry.event.id)));

  const shown = useMemo(() => entries.filter((entry) => matchesFilter(entry.event, filter, person)), [entries, filter, person]);

  return (
    <section aria-label="Activity" className="flex flex-col gap-3">
      <div className="rounded-card bg-card p-3 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-ink">Activity</h2>
          <span className="text-[13px] text-ink-2">{shown.length === entries.length ? `${entries.length} posts` : `${shown.length} of ${entries.length}`}</span>
        </div>
        <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3">
          {FEED_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[14px] font-semibold transition-colors ${filter === option.id ? "bg-tint text-primary" : "bg-button-2 text-ink hover:brightness-95"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3" role="group" aria-label="Filter by person">
          {people.map((candidate) => {
            const active = person === candidate.id;
            return (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPerson(active ? null : candidate.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-[13px] font-semibold transition-colors ${active ? "bg-tint text-primary" : "text-ink-2 hover:bg-hover"}`}
              >
                <Avatar id={candidate.id} name={candidate.name} size={24} />
                {firstName(candidate.name)}
              </button>
            );
          })}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-card bg-card shadow-card">
          <EmptyState title="No posts yet">
            Every action lands here as a post: an agent claiming an item, a progress note, a question, a decision. Agents post through
            the hub CLI; people post by acting on the Board and Decide tabs.
          </EmptyState>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-card bg-card shadow-card">
          <EmptyState title="Nothing matches">Clear the filters above to see every post.</EmptyState>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.slice(0, limit).map((entry) => (
            <li key={entry.event.id} className={!initialIds.has(entry.event.id) ? "feed-enter" : undefined}>
              <div>
                <FeedCard entry={entry} nowMs={nowMs} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {shown.length > limit && (
        <button
          type="button"
          onClick={() => setLimit(limit + PAGE)}
          className="rounded-control bg-button-2 py-2 text-[15px] font-semibold text-ink hover:brightness-95"
        >
          Show older posts
        </button>
      )}
    </section>
  );
}
