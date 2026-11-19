import { mentions, wikiLinks } from "./kb";
import { hrefFor, refKindOf, type RefKind } from "./links";
import type { Board, KbPage } from "./types";

// The knowledge map: kb pages as nodes and `[[kb/...]]` links as edges, with
// people and open board work attached where their text or owner links them.
// Nodes sit in five labeled clusters around the index so the map teaches the
// event at a glance. Layout is a pure function of the board: the same board
// always draws the same picture, on the server and the client alike.

export type NodeKind = Exclude<RefKind, "session">;
export type GroupId = "rules" | "tracks" | "ideas" | "team" | "logistics";

export interface Group {
  id: GroupId;
  label: string;
  /** The page that sits in the middle of the cluster. */
  lead: string;
}

export const GROUPS: Group[] = [
  { id: "rules", label: "Rules and judging", lead: "kb/rules" },
  { id: "tracks", label: "Tracks", lead: "kb/tracks" },
  { id: "ideas", label: "Ideas", lead: "kb/ideas" },
  { id: "team", label: "Team", lead: "kb/team" },
  { id: "logistics", label: "Logistics", lead: "kb/logistics" },
];

const GROUP_IDS = new Set<string>(GROUPS.map((group) => group.id));

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Full title, for the caption and the list. */
  label: string;
  /** Short name for the map itself. */
  short: string;
  href: string;
  /** null only for the index, which sits in the middle of everything. */
  group: GroupId | null;
}

export type Edge = [string, string];
export type Point = { x: number; y: number };
export type Positions = Record<string, Point>;

export const HUB_NODE = "kb/index";

const SLUG_GROUPS: Array<[RegExp, GroupId]> = [
  [/^(tracks|track-.+|prizes?)$/, "tracks"],
  [/^(rules|judging|open-questions|mentor-questions|submission.*|devpost.*)$/, "rules"],
  [/^(ideas?|idea-.+|past-winners|pitch.*|demo.*)$/, "ideas"],
  [/^(team|working-agreement|lessons|prior-art|project-repo|people.*)$/, "team"],
  [/^(logistics|playbook|hardware.*|weekend-plan|schedule.*|venue.*|food.*)$/, "logistics"],
];

function normalizeTarget(target: string, kbSlugs: Set<string>): string {
  const clean = target.trim().replace(/\.md$/, "");
  if (clean.startsWith("kb/")) return clean;
  if (kbSlugs.has(clean)) return `kb/${clean}`;
  return clean;
}

/** The name a node carries on the map: no quotes, no parenthetical, no "Idea:" or "track" filler. */
export function shortLabel(title: string, group: GroupId | null): string {
  let short = title.replace(/^["']|["']$/g, "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  short = short.replace(/^idea:\s*/i, "");
  if (group === "tracks") short = short.replace(/\s+tracks?$/i, "");
  return short.length > 22 ? `${short.slice(0, 21).trimEnd()}…` : short;
}

function majority(groups: GroupId[]): GroupId | null {
  if (groups.length === 0) return null;
  const counts = new Map<GroupId, number>();
  for (const group of groups) counts.set(group, (counts.get(group) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || GROUPS.findIndex((g) => g.id === a[0]) - GROUPS.findIndex((g) => g.id === b[0]))[0]![0];
}

export function buildGraph(board: Board, pages: KbPage[]): { nodes: GraphNode[]; edges: Edge[] } {
  const peopleIds = board.people.map((person) => person.id);
  const kbSlugs = new Set(pages.map((page) => page.slug));
  const nodes: GraphNode[] = [];
  const add = (id: string, kind: NodeKind, label: string) =>
    nodes.push({ id, kind, label, short: label, href: hrefFor(id, peopleIds) ?? "/", group: null });

  for (const page of pages) add(`kb/${page.slug}`, "kb", page.title);
  for (const person of board.people) add(person.id, "person", person.name);
  // Only work that is still open: a finished item is history, not a place on the map.
  for (const item of board.items) if (item.lane !== "done") add(item.id, "item", item.title);
  for (const question of board.questions) if (question.status === "open") add(question.id, "question", question.title);
  for (const decision of board.decisions) if (decision.status === "proposed") add(decision.id, "decision", decision.title);
  for (const gate of board.gates) if (gate.status === "open" || gate.status === "proposed") add(gate.id, "gate", gate.title);

  const known = new Set(nodes.map((node) => node.id));
  const edgeKeys = new Set<string>();
  const link = (a: string | null | undefined, b: string | null | undefined) => {
    if (!a || !b || a === b || !known.has(a) || !known.has(b)) return;
    edgeKeys.add([a, b].sort().join("\u0000"));
  };
  const linkText = (from: string, text: string | undefined) => {
    if (!text) return;
    for (const target of wikiLinks(text)) link(from, normalizeTarget(target, kbSlugs));
    for (const id of mentions(text, peopleIds)) link(from, id);
    for (const match of text.matchAll(/\(([a-z0-9][a-z0-9/_-]*)\.md\)/gi)) link(from, normalizeTarget(match[1] ?? "", kbSlugs));
  };

  for (const page of pages) linkText(`kb/${page.slug}`, page.body);
  for (const item of board.items) {
    link(item.id, item.owner);
    linkText(item.id, item.text);
    linkText(item.id, item.why ?? undefined);
  }
  for (const question of board.questions) {
    link(question.id, question.askedBy);
    link(question.id, question.for);
    link(question.id, question.blocking);
    linkText(question.id, question.text);
  }
  for (const decision of board.decisions) {
    link(decision.id, decision.proposedBy);
    for (const target of decision.affects) link(decision.id, normalizeTarget(String(target), kbSlugs));
    linkText(decision.id, decision.text);
    linkText(decision.id, decision.why);
  }
  for (const gate of board.gates) linkText(gate.id, gate.text);
  for (const event of board.activity) {
    if (!event.ref || refKindOf(event.ref) === "session") continue;
    linkText(event.ref, event.text);
    if (event.type === "kb.update" && typeof event.data.page === "string") link(normalizeTarget(event.data.page, kbSlugs), event.by);
  }

  const allEdges = [...edgeKeys].sort().map((key) => key.split("\u0000") as Edge);
  // Open work joins the map only when it names a page: an item linked to no
  // page is not knowledge, and it already has a place on the Board.
  const kinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const keep = new Set(
    nodes
      .filter((node) => node.kind === "kb" || node.kind === "person" || allEdges.some(([a, b]) => (a === node.id && kinds.get(b) === "kb") || (b === node.id && kinds.get(a) === "kb")))
      .map((node) => node.id),
  );
  const kept = nodes.filter((node) => keep.has(node.id));
  const edges = allEdges.filter(([a, b]) => keep.has(a) && keep.has(b));
  assignGroups(kept, edges, pages);
  return { nodes: kept, edges };
}

// Pages first: the frontmatter `group:`, then the slug, then the kind. A page
// with none of those joins the group most of its page links point to. Then
// people go to Team, and open work goes where most of its page links point,
// else to its owner's cluster, Team.
function assignGroups(nodes: GraphNode[], edges: Edge[], pages: KbPage[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pageBySlug = new Map(pages.map((page) => [`kb/${page.slug}`, page]));
  const neighborGroups = (id: string) =>
    [...neighborsOf(id, edges)].map((other) => byId.get(other)).filter((node) => node?.kind === "kb" && node.group).map((node) => node!.group!);

  const undecided: GraphNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "kb" || node.id === HUB_NODE) continue;
    const page = pageBySlug.get(node.id);
    const slug = node.id.slice(3);
    const explicit = page?.group?.trim().toLowerCase();
    const fromSlug = SLUG_GROUPS.find(([pattern]) => pattern.test(slug))?.[1];
    const fromKind = page?.kind === "idea" ? "ideas" : page?.kind === "person" ? "team" : undefined;
    node.group = (explicit && GROUP_IDS.has(explicit) ? (explicit as GroupId) : undefined) ?? fromSlug ?? fromKind ?? null;
    if (!node.group) undecided.push(node);
  }
  for (const node of undecided) node.group = majority(neighborGroups(node.id)) ?? "ideas";
  for (const node of nodes) {
    if (node.kind === "person") node.group = "team";
    else if (node.kind !== "kb") node.group = majority(neighborGroups(node.id)) ?? "team";
    node.short = node.kind === "person" ? (node.label.split(" ")[0] ?? node.label) : shortLabel(node.label, node.group);
  }
}

export function neighborsOf(id: string, edges: Edge[]): Set<string> {
  const neighbors = new Set<string>();
  for (const [a, b] of edges) {
    if (a === id) neighbors.add(b);
    if (b === id) neighbors.add(a);
  }
  return neighbors;
}

// Layout. Each cluster puts its lead page in the middle, its other pages and
// people on a ring, and open work on an outer ring. Two frames: wide (labels
// beside every page) and narrow (a phone: cluster names only, tap for the rest).

export interface Frame {
  name: "wide" | "narrow";
  width: number;
  height: number;
  hub: Point;
  centers: Record<GroupId, Point>;
  /** Distance between neighbors on a ring. */
  spacing: number;
  minRadius: number;
}

export const WIDE: Frame = {
  name: "wide",
  width: 1000,
  height: 600,
  hub: { x: 500, y: 330 },
  centers: {
    tracks: { x: 500, y: 140 },
    rules: { x: 215, y: 250 },
    ideas: { x: 785, y: 250 },
    team: { x: 305, y: 475 },
    logistics: { x: 695, y: 475 },
  },
  spacing: 32,
  minRadius: 36,
};

export const NARROW: Frame = {
  name: "narrow",
  width: 360,
  height: 470,
  hub: { x: 180, y: 250 },
  centers: {
    tracks: { x: 180, y: 108 },
    rules: { x: 72, y: 262 },
    ideas: { x: 288, y: 262 },
    team: { x: 100, y: 398 },
    logistics: { x: 260, y: 398 },
  },
  spacing: 27,
  minRadius: 26,
};

export interface PlacedNode {
  x: number;
  y: number;
  /** Which side of the node its map label sits on. */
  side: "left" | "right" | "above" | "below";
  ring: 0 | 1 | 2;
}

export interface MapLayout {
  frame: Frame;
  nodes: Record<string, PlacedNode>;
  clusters: Array<{ group: GroupId; x: number; y: number; radius: number; count: number }>;
}

const round = (value: number) => Math.round(value * 10) / 10;

function ring(ids: string[], center: Point, radius: number, offset: number, into: Record<string, PlacedNode>, level: 1 | 2) {
  ids.forEach((id, i) => {
    const angle = -Math.PI / 2 + offset + (i / ids.length) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const side = cos > 0.3 ? "right" : cos < -0.3 ? "left" : sin < 0 ? "above" : "below";
    into[id] = { x: round(center.x + radius * cos), y: round(center.y + radius * sin), side, ring: level };
  });
}

const KIND_ORDER: Record<NodeKind, number> = { kb: 0, person: 1, item: 2, question: 3, decision: 4, gate: 5 };

export function mapLayout(nodes: GraphNode[], frame: Frame): MapLayout {
  const placed: Record<string, PlacedNode> = {};
  const clusters: MapLayout["clusters"] = [];
  if (nodes.some((node) => node.id === HUB_NODE)) placed[HUB_NODE] = { ...frame.hub, side: "below", ring: 0 };
  for (const group of GROUPS) {
    const center = frame.centers[group.id];
    const members = nodes
      .filter((node) => node.group === group.id)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.short.localeCompare(b.short));
    if (members.length === 0) continue;
    const lead = members.find((node) => node.id === group.lead) ?? null;
    const inner = members.filter((node) => node !== lead && (node.kind === "kb" || node.kind === "person")).map((node) => node.id);
    const outer = members.filter((node) => node.kind !== "kb" && node.kind !== "person").map((node) => node.id);
    if (lead) placed[lead.id] = { ...center, side: "above", ring: 0 };
    // A person's avatar is wider than a page dot, so it takes a step and a half.
    const steps = inner.reduce((sum, id) => sum + (members.find((node) => node.id === id)?.kind === "person" ? 1.5 : 1), 0);
    const innerRadius = Math.max(frame.minRadius, (steps * frame.spacing) / (Math.PI * 2));
    // Half a step off the top, so no page sits right under the cluster name.
    ring(inner, center, innerRadius, Math.PI / Math.max(inner.length, 1), placed, 1);
    const outerRadius = innerRadius + frame.spacing * 0.8;
    ring(outer, center, outerRadius, 0, placed, 2);
    clusters.push({ group: group.id, x: center.x, y: center.y, radius: outer.length > 0 ? outerRadius : innerRadius, count: members.length });
  }
  return { frame, nodes: placed, clusters };
}
