import Link from "next/link";
import type { FeedEntry } from "@/lib/web/entries";
import { verbFor } from "@/lib/web/feed";
import { formatRelative, formatStamp } from "@/lib/web/format";
import { Avatar } from "./Avatar";
import { TerminalIcon } from "./icons";

// One event as a post. The person leads; the agent tool that wrote it sits
// behind, smaller, in the meta line.

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function FeedCard({ entry, nowMs, compact = false }: { entry: FeedEntry; nowMs: number; compact?: boolean }) {
  const { event, html, byName, byFullName, refLabel, refHref } = entry;
  const links = [...asStrings(event.data.links), ...asStrings(event.data.files)];
  const commit = typeof event.data.commit === "string" ? event.data.commit : null;
  // Inside a thread the ref is the thing on screen, so it is not repeated.
  const showRef = !compact && refLabel && refLabel !== event.title;

  return (
    <article className={compact ? "py-2" : "rounded-card bg-card shadow-card"} id={event.id}>
      <div className={`flex gap-2.5 ${compact ? "" : "px-4 pt-3"}`}>
        <Link href={`/p/${event.by}`} className="shrink-0" tabIndex={-1} aria-hidden="true">
          <Avatar id={event.by} name={byFullName} size={compact ? 32 : 40} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug text-ink">
            <Link href={`/p/${event.by}`} className="font-semibold hover:underline">
              {byName}
            </Link>{" "}
            <span className="text-ink-2">{verbFor(event.type)}</span>
            {showRef && (
              <>
                {" "}
                {refHref ? (
                  <Link href={refHref} className="font-semibold hover:underline">
                    {refLabel}
                  </Link>
                ) : (
                  <span className="font-semibold">{refLabel}</span>
                )}
              </>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
            <time dateTime={event.at} title={formatStamp(Date.parse(event.at))}>
              {formatRelative(event.at, nowMs)}
            </time>
            {event.via === "agent" && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <TerminalIcon size={13} />
                  {event.agent ?? "agent"}
                </span>
              </>
            )}
            {event.via === "web" && (
              <>
                <span aria-hidden="true">·</span>
                <span>from the board</span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className={compact ? "mt-1 pl-[42px]" : "px-4 pt-2 pb-3"}>
        <p className="text-[15px] leading-snug text-ink">{event.title}</p>
        {html && <div className="prose-hub mt-1 text-[14px] text-ink" dangerouslySetInnerHTML={{ __html: html }} />}
        {(links.length > 0 || commit) && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {links.map((link) => (
              <li key={link}>
                {/^https?:/.test(link) ? (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="inline-block max-w-[260px] truncate rounded-control bg-card-flat px-2 py-0.5 align-bottom text-[12px] font-semibold text-link hover:underline">
                    {link.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="inline-block max-w-[260px] truncate rounded-control bg-card-flat px-2 py-0.5 align-bottom text-[12px] text-ink-2">{link}</span>
                )}
              </li>
            ))}
            {commit && <li className="rounded-control bg-card-flat px-2 py-0.5 text-[12px] text-ink-2">commit {commit.slice(0, 7)}</li>}
          </ul>
        )}
      </div>
    </article>
  );
}
