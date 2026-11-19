import "server-only";
import { refTitle } from "./feed";
import { hrefFor } from "./links";
import { renderMarkdown } from "./markdown";
import { firstName } from "./people";
import type { Board, HubEvent } from "./types";

// Events ready for the client: markdown rendered on the server (so the browser
// never ships the parser) and the ref's title and link resolved.

export interface FeedEntry {
  event: HubEvent;
  html: string | null;
  byName: string;
  byFullName: string;
  refLabel: string | null;
  refHref: string | null;
}

export function toEntry(board: Board, event: HubEvent, repo: string | null): FeedEntry {
  const peopleIds = board.people.map((person) => person.id);
  const person = board.people.find((candidate) => candidate.id === event.by);
  const page = event.type === "kb.update" && typeof event.data.page === "string" ? event.data.page : null;
  const kbRef = page ? (page.startsWith("kb/") ? page : `kb/${page}`) : null;
  return {
    event,
    html: event.text ? renderMarkdown(event.text, { peopleIds, repo }) : null,
    byName: person ? firstName(person.name) : event.by,
    byFullName: person?.name ?? event.by,
    refLabel: kbRef ?? refTitle(board, event.ref),
    refHref: kbRef ? hrefFor(kbRef) : event.ref ? hrefFor(event.ref, peopleIds) : null,
  };
}

export function toEntries(board: Board, events: HubEvent[], repo: string | null): FeedEntry[] {
  return events.map((event) => toEntry(board, event, repo));
}
