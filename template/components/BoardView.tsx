"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { formatStamp } from "@/lib/web/format";
import { LANE_LABEL } from "@/lib/web/lanes";
import { firstName } from "@/lib/web/people";
import { byRelevance, isLongPastDue } from "@/lib/web/relevance";
import { LANE_ORDER, type Lane } from "@/lib/web/types";
import type { ItemView } from "@/lib/web/views";
import { Avatar } from "./Avatar";
import { Chip } from "./Card";
import { ActionButton, CommentBox } from "./CommentBox";
import { FeedCard } from "./FeedCard";
import { ActReceipt, useAct, useHub } from "./HubContext";
import { Sheet } from "./Sheet";
import { useNow } from "./useNow";


const LANE_HINT: Record<Lane, string> = {
  needs_human: "Work waiting on a person. Answer it here and it moves on.",
  in_flight: "What someone is working on right now.",
  up_next: "New work lands here until someone takes it.",
  done: "Finished work, with its links.",
};

export function BoardView({ views, nowIso }: { views: ItemView[]; nowIso: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openId = params.get("item");
  const open = views.find((view) => view.item.id === openId) ?? null;
  const nowMs = useNow(nowIso);
  // Open work: due soonest on top (lib/web/relevance.ts). Done: newest first.
  const relevance = byRelevance(nowMs);

  const setOpen = useCallback(
    (id: string | null) => router.replace(id ? `${pathname}?item=${encodeURIComponent(id)}` : pathname, { scroll: false }),
    [router, pathname],
  );

  return (
    <>
      <AddItem />
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANE_ORDER.map((lane) => {
          const laneViews = views
            .filter((view) => view.item.lane === lane)
            .sort((a, b) => (lane === "done" ? b.item.updatedAt.localeCompare(a.item.updatedAt) : relevance(a.item, b.item)));
          return (
            <section key={lane} aria-label={LANE_LABEL[lane]} className="flex min-w-0 flex-col rounded-card bg-card-flat/60 md:bg-transparent">
              <div className="flex items-baseline justify-between px-1 pb-2">
                <h2 className={`text-[17px] font-semibold ${lane === "needs_human" && laneViews.length > 0 ? "text-primary" : "text-ink"}`}>{LANE_LABEL[lane]}</h2>
                <span className="text-[13px] text-ink-2 tabular-nums">{laneViews.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {laneViews.length === 0 && (
                  <li className="rounded-card border border-dashed border-divider px-3 py-4 text-center text-[13px] leading-snug text-ink-2">{LANE_HINT[lane]}</li>
                )}
                {laneViews.map((view) => (
                  <li key={view.item.id}>
                    <ItemCard view={view} nowMs={nowMs} onOpen={() => setOpen(view.item.id)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {open && (
        <Sheet title={open.item.title} onClose={() => setOpen(null)}>
          <ItemDetail view={open} nowIso={nowIso} />
        </Sheet>
      )}
    </>
  );
}

function ItemCard({ view, nowMs, onOpen }: { view: ItemView; nowMs: number; onOpen: () => void }) {
  const { people } = useHub();
  const { item } = view;
  const owner = people.find((person) => person.id === item.owner);
  const needs = item.needs ? (item.needs === "team" ? "the team" : firstName(people.find((person) => person.id === item.needs)?.name ?? item.needs)) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-card bg-card p-3 text-left shadow-card transition-[transform,box-shadow] duration-200 ease-[var(--ease-move)] hover:-translate-y-px hover:shadow-float"
    >
      <span className="block text-[15px] leading-snug font-semibold text-ink">{item.title}</span>
      {item.lane === "needs_human" && item.blocker && (
        <span className="mt-1 block text-[13px] leading-snug text-ink">
          <span className="font-semibold text-primary">Needs {needs}:</span> {item.blocker}
        </span>
      )}
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        {owner ? (
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2">
            <Avatar id={owner.id} name={owner.name} size={20} />
            {firstName(owner.name)}
          </span>
        ) : (
          <span className="text-[12px] text-ink-2">Unclaimed</span>
        )}
        {item.area && <Chip>{item.area}</Chip>}
        {item.due && <span className="text-[12px] text-ink-2">{item.lane !== "done" && isLongPastDue(item.due, nowMs) ? "was due" : "due"} {formatStamp(Date.parse(item.due))}</span>}
        {view.thread.length > 0 && <span className="ml-auto text-[12px] text-ink-2">{view.thread.length} in thread</span>}
      </span>
    </button>
  );
}

function ItemDetail({ view, nowIso }: { view: ItemView; nowIso: string }) {
  const { people, who } = useHub();
  const { act, state } = useAct();
  const nowMs = useNow(nowIso);
  const { item } = view;
  const owner = people.find((person) => person.id === item.owner);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <Chip tone="primary">{LANE_LABEL[item.lane]}</Chip>
        {owner ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar id={owner.id} name={owner.name} size={22} />
            {owner.name}
          </span>
        ) : (
          <span>Unclaimed</span>
        )}
        {item.area && <Chip>{item.area}</Chip>}
        {item.due && <span>due {formatStamp(Date.parse(item.due))}</span>}
        <span className="text-ink-2">{item.id}</span>
      </div>

      {item.lane === "needs_human" && item.blocker && (
        <div className="rounded-card bg-tint px-3 py-2 text-[14px] text-ink">
          <span className="font-semibold text-primary">Blocked: </span>
          {item.blocker}
        </div>
      )}
      {item.why && <p className="text-[14px] text-ink"><span className="font-semibold">Why: </span>{item.why}</p>}
      {view.textHtml && <div className="prose-hub text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: view.textHtml }} />}
      {item.links.length > 0 && (
        <ul className="flex flex-col gap-1 text-[14px]">
          {item.links.map((link) => (
            <li key={link} className="truncate">
              {/^https?:/.test(link) ? <a className="text-link hover:underline" href={link} target="_blank" rel="noopener noreferrer">{link}</a> : <span className="text-ink-2">{link}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {item.owner !== who && item.lane !== "done" && <ActionButton label="Claim it" tone="primary" onAct={() => act({ type: "item.claim", ref: item.id, title: `Claimed: ${item.title}` })} />}
        {item.lane !== "done" && <ActionButton label="Mark done" onAct={() => act({ type: "item.done", ref: item.id, title: `Done: ${item.title}` })} />}
        <MoveLane itemId={item.id} title={item.title} current={item.lane} />
        <ActReceipt state={state} />
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-ink">Thread</h3>
        {view.thread.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-2">Progress notes from agents and comments from people show up here.</p>
        ) : (
          <ol className="mt-1 divide-y divide-hairline">
            {view.thread.map((entry) => (
              <li key={entry.event.id}>
                <FeedCard entry={entry} nowMs={nowMs} compact />
              </li>
            ))}
          </ol>
        )}
      </div>
      <CommentBox refId={item.id} />

      <details className="rounded-card bg-card-flat px-3 py-2">
        <summary className="cursor-pointer text-[14px] font-semibold text-ink">History ({view.history.length})</summary>
        <ol className="mt-1 divide-y divide-hairline">
          {view.history.map((entry) => (
            <li key={entry.event.id}>
              <FeedCard entry={entry} nowMs={nowMs} compact />
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function MoveLane({ itemId, title, current }: { itemId: string; title: string; current: Lane }) {
  const { act } = useAct();
  const fieldId = useId();
  return (
    <label htmlFor={fieldId} className="inline-flex items-center gap-1.5 text-[14px] text-ink-2">
      Move to
      <select
        id={fieldId}
        value={current}
        onChange={(event) => {
          const lane = event.target.value as Lane;
          void act({ type: "item.update", ref: itemId, title: `Moved to ${LANE_LABEL[lane]}: ${title}`.slice(0, 140), data: { lane } });
        }}
        className="rounded-control bg-button-2 px-2 py-1.5 text-[14px] font-semibold text-ink"
      >
        {LANE_ORDER.map((lane) => (
          <option key={lane} value={lane}>
            {LANE_LABEL[lane]}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddItem() {
  const [title, setTitle] = useState("");
  const { act, state } = useAct();
  const titleId = useId();
  return (
    <form
      className="flex flex-col gap-2 rounded-card bg-card p-3 shadow-card sm:flex-row sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        if (await act({ type: "item.add", title: title.trim() })) setTitle("");
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={titleId} className="text-[13px] font-semibold text-ink-2">
          New item for Up next
        </label>
        <input
          id={titleId}
          value={title}
          maxLength={140}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-control bg-card-flat px-3 py-2 text-[15px] text-ink focus:outline-2 focus:outline-primary"
        />
      </div>
      <div className="flex items-center gap-2">
        <ActReceipt state={state} />
        <button type="submit" disabled={!title.trim()} className="rounded-control bg-primary px-4 py-2 text-[15px] font-semibold text-on-primary disabled:opacity-40">
          Add item
        </button>
      </div>
    </form>
  );
}
