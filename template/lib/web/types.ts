// The board as the web app sees it. lib/hub/fold.mjs is the one implementation
// of the fold; these types describe its output (docs/CONTRACT.md, "fold.mjs API")
// so the components can be typed without re-implementing anything.

export type Result<T> = { data: T; error: null } | { data: null; error: string };

export type Via = "agent" | "web" | "human";
export type Lane = "needs_human" | "in_flight" | "up_next" | "done";
export const LANE_ORDER: Lane[] = ["needs_human", "in_flight", "up_next", "done"];

export interface HubEvent {
  v: 1;
  id: string;
  at: string;
  by: string;
  via: Via;
  agent?: string;
  type: string;
  ref?: string;
  title: string;
  text?: string;
  data: Record<string, unknown>;
}

export interface Item {
  id: string;
  title: string;
  text: string;
  lane: Lane;
  owner: string | null;
  status: string | null;
  due: string | null;
  area: string | null;
  why: string | null;
  needs: string | null;
  blocker: string | null;
  links: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  notes: HubEvent[];
  comments: HubEvent[];
  history: HubEvent[];
}

export interface Question {
  id: string;
  title: string;
  text: string;
  for: string;
  blocking: string | null;
  status: "open" | "settled";
  askedBy: string;
  askedAt: string;
  answers: HubEvent[];
  settled: HubEvent | null;
  answer: string | null;
  comments: HubEvent[];
}

export interface Decision {
  id: string;
  title: string;
  text: string;
  why: string;
  affects: string[];
  status: "proposed" | "accepted" | "rejected";
  proposedBy: string;
  proposedAt: string;
  resolved: HubEvent | null;
  comments: HubEvent[];
}

export interface Gate {
  id: string;
  title: string;
  text: string;
  criteria: string[];
  due: string | null;
  status: "open" | "proposed" | "passed" | "failed";
  addedBy: string;
  addedAt: string;
  history: HubEvent[];
  comments: HubEvent[];
}

export interface Session {
  id: string;
  by: string;
  agent: string | null;
  focus: string;
  repo: string | null;
  branch: string | null;
  startedAt: string;
  lastAt: string;
  endedAt: string | null;
  summary: string | null;
  idle: boolean;
}

export interface TeamPerson {
  id: string;
  name: string;
  school?: string;
  focus?: string;
  github?: string;
  githubId?: number;
  commitEmail?: string;
  emails?: string[];
}

export interface Person extends TeamPerson {
  openItems: string[];
  openQuestions: string[];
  activeSession: string | null;
  lastSeenAt: string | null;
  pulses?: unknown[];
}

export interface Board {
  items: Item[];
  questions: Question[];
  decisions: Decision[];
  gates: Gate[];
  sessions: Session[];
  people: Person[];
  activity: HubEvent[];
  /** Latest pulse per person per repo, raw from the fold; read through lib/web/pulses.ts. */
  pulses?: unknown[];
  overlaps?: unknown[];
  rejected: Array<{ file: string; reason: string }>;
}

export interface KbPage {
  slug: string;
  title: string;
  kind: string | null;
  updated: string | null;
  by: string | null;
  /** Optional `group:` from the frontmatter: which cluster of the map the page sits in. */
  group: string | null;
  body: string;
}

export type Presence = "active" | "idle" | "away";
