# Hub data contract

The single source of truth for how the hub stores state. The tool, the board, and every agent follow this file. Change it first, then the code.

## Principles

- **Append-only events are the record.** Every action is one new JSON file. Nobody edits or deletes an event file. Five agents can push at once without merge conflicts.
- **State is a fold.** The board (items, questions, decisions, gates, sessions) is computed by replaying events in `at` order. `lib/hub/fold.mjs` is the one implementation, shared by the tool and the web app.
- **Knowledge lives in markdown.** `kb/*.md` pages are edited in place (small pages, one topic each) and announced with a `kb.update` event.
- **People can veto: agents decide and record, a person may accept or reject afterwards.** `decision.accept`, `decision.reject`, `gate.pass`, and `gate.fail` are still people-only event types.

## Repo layout

```
hub.config.json      the event: name, time zone, dates, repo, base path, owner (below)
team.json            people (below)
events/YYYY-MM-DD/   <epochms>-<by>-<rand4>.json, one per action, UTC date folder
kb/                  markdown knowledge pages; ./hub kb lists every page, kb/index.md maps the starter pages
design/              images: review/ (posted by ./hub design), reference/, mockups/
sources/             raw material, verbatim, never edited (meeting notes, emails)
lib/hub/             fold.mjs, schema.mjs (zero dependency, plain ESM with JSDoc types)
scripts/hub.mjs      the tool every agent uses; ./hub is a wrapper
app/ components/ lib/web/   the Next.js board
AGENTS.md            the protocol agents read first
```

## hub.config.json

Everything specific to one event. `lib/hub/config.mjs` reads and checks it for the tool, the board, and setup; nothing else hard-codes these values.

```json
{
  "v": 1,
  "event": { "name": "Sample Hackathon", "slug": "sample-hackathon", "timezone": "America/New_York", "startsAt": "", "submitBy": "", "location": "", "url": "" },
  "hub": { "repo": "", "basePath": "", "owner": "ada" }
}
```

- `event.timezone`: an IANA zone. The board shows every time in it, and `--due` times without an offset are read in it, on every machine (`HUB_TZ` changes only how the tool shows times).
- `event.startsAt`, `event.submitBy`: a time with its offset, or `""`. The board counts down to `submitBy` and starts its progress at `startsAt` unless `kb/playbook.md` lists its own submission deadline or "Hacking starts" line.
- `hub.repo`: `owner/name` of this repo, or `""` before it exists. `hub.basePath`: `""` for a standalone board, or a path like `/hub` when mounted under another site. `hub.owner`: the team id of the person who set it up.
- The board reads `basePath` and `timezone` at build time, so changing them needs a redeploy; the other values are read with the data.
- Unknown keys are kept, so a newer hub can add settings without breaking an older reader.

## team.json

```json
{ "people": [ { "id": "ada", "name": "Ada Example", "focus": "Product and frontend", "github": "ada-example", "githubId": null, "commitEmail": "ada@example.com", "emails": [] } ] }
```

Ids are lowercase letters, digits, and underscores, starting with a letter (`ada`, `grace`, `linus` in the samples). `github` may be empty until known. Optional credit keys: `githubId` (number, or `null` until known), `commitEmail` (the address every hub commit by that person is authored with; for a real person, their GitHub no-reply address `<githubId>+<github>@users.noreply.github.com`, which setup fills in when `gh` is logged in), and `emails` (other addresses of theirs already verified on GitHub). Readers ignore keys they do not know.

The samples use `@example.com` addresses and no `githubId` on purpose: an id-prefixed no-reply address credits whichever real GitHub account has that id, so sample data never carries one.

## Event envelope

```json
{
  "v": 1,
  "id": "1800075600000-ada-k3x9",
  "at": "2027-01-16T05:00:00.000Z",
  "by": "ada",
  "via": "agent",
  "agent": "claude-code",
  "type": "item.claim",
  "ref": "t-a3f9",
  "title": "short human line, under 140 chars",
  "text": "optional longer markdown, under 4000 chars",
  "data": {}
}
```

- `id` equals the filename without `.json`. `by` is a `team.json` id. `via` is `agent`, `web`, or `human` (a person at a terminal).
- `agent` is free text naming the tool (claude-code, cursor, codex). Omitted when `via` is not `agent`.
- `ref` is the id of the thing acted on. Ids are a type prefix plus 4 random base36 chars: `t-` item, `q-` question, `d-` decision, `g-` gate, `s-` session. The creating event sets `ref` to the new id.
- In `text`, link things with `[[t-a3f9]]`, `[[kb/rules]]` (knowledge page slug), and `@grace`. These become knowledge graph edges.
- Unknown types and unknown `data` keys are kept and shown in the feed, never dropped.

## Event types

| type | who | ref | data | effect |
|---|---|---|---|---|
| `item.add` | anyone | new `t-` | `owner?`, `lane?`, `due?` (ISO with offset), `area?`, `why?` | creates an item, default lane `up_next` |
| `item.claim` | anyone | item | `why?`, `take?` (true: the current owner agreed) | owner becomes `by`, lane `in_flight`; first claim wins (below) |
| `item.update` | anyone | item | any of `title`, `owner`, `lane`, `status`, `due`, `area` | patches the item |
| `item.block` | anyone | item | `needs?` (person id or `team`) | lane `needs_human`, `text` says what is needed |
| `item.done` | anyone | item | `links?` (array of urls or paths) | lane `done` |
| `note` | anyone | optional any id | `files?`, `repo?`, `branch?`, `commit?` | progress line in the feed and on the ref |
| `question.ask` | anyone | new `q-` | `for?` (person id or `team`), `blocking?` (item id) | opens a question |
| `question.answer` | anyone | question | | adds an answer, question stays open |
| `question.settle` | anyone | question | `answer` (final text) | closes it; `via` shows whether a person or agent settled |
| `decision.propose` | anyone | new `d-` | `why`, `affects?` (array of ids or kb slugs) | status `proposed` |
| `decision.accept` / `decision.reject` | **human or web only** | decision | | sets status |
| `gate.add` | anyone | new `g-` | `due?` (ISO with offset), `criteria` (array of strings) | status `open` |
| `gate.propose` | anyone | gate | `evidence?` (array) | status `proposed`, an agent says it is ready |
| `gate.pass` / `gate.fail` | **human or web only** | gate | | sets status |
| `kb.update` | anyone | none | `page` (slug, e.g. `kb/rules`), `change` (`new` or `edit`) | announces a kb change |
| `script.edit` | web | none | `cue` (`p3:U2b`: part id and cue number in `kb/pitch-script.md`), `field` (`line` or `dir`), `text` (the new text; empty removes it), `revert?` (true goes back to the knowledge page's text) | a line saved on the pitch script page; per cue and field the latest wins |
| `script.clock` | web | none | the whole clock state: `action` (`start`, `pause`, `resume`, `next`, `reset`), `running`, `base` (seconds at `atMs`), `atMs` (server ms), `current` (timed part index), `partStart`, `splits` | a press on the pitch script page's shared clock; the latest `atMs` wins; kept out of the feed |
| `session.start` | agent | new `s-` | `repo?`, `branch?`, `focus` | shows who is working on what right now |
| `session.end` | agent | session | | closes it; `text` is a five line max summary |
| `comment` | anyone | any id | | threaded comment on any object |
| `pulse` | agent | none | `repo` (name, required), `branch?`, `pushed` (origin/<branch> exists and contains HEAD), `ahead`, `behind` (versus origin/main), `files` (changed since the merge-base with origin/main plus uncommitted, max 60), `pr?` (`{ number, url, state? }`), `item?` (the author's one in-flight item), `note?` (one line of intent) | state, not history: the latest per person per repo; counts for last seen; never in the activity feed |

Lanes: `needs_human`, `in_flight`, `up_next`, `done`.

**Due times** (`due` on `item.add`, `item.update`, `gate.add`) always carry their offset (`2027-01-17T09:00-05:00`, or `Z`), so they mean one moment on every machine; `validateEvent` rejects one without. The tool turns what people type (`2027-01-17 13:30`, `2027-01-17 1:30 pm`, a bare date read as 23:59) into that form, reading it in `event.timezone`, and refuses anything else.

**First claim wins.** An `item.claim` with `via: "agent"` on an item that someone else already has `in_flight` does not change the owner unless it carries `take: true`; it stays in the item's history. A claim from a person on the board (`via` `web` or `human`) always takes the item. `./hub claim` also checks after every rebase whether someone else claimed, reassigned, or finished the item since it looked, and if so withdraws its own commit before pushing and fails; after a push it reads the fold and tells the loser if the item went to someone else.

A session with no event from its author for 45 minutes is shown as idle, not closed.

### Title prefixes

A question whose title starts with `Design review:` is a design review: its `text` holds one or more images and optional notes, its answers are the team's feedback, and settling it marks the review resolved. The board lists these on the Design page only, not in "Needs you" or on Decide. `./hub design` writes them. Questions starting with `Mentor question:` or `Organizer question:` form the mentor list (see AGENTS.md).

### Images in markdown

`![alt](path)` renders as an image only when `path` is a repo path under `design/review/`, `design/reference/`, or `design/mockups/` ending in `.webp`, `.png`, `.jpg`, or `.jpeg`, with no `..` and only letters, digits, `.`, `_`, `-` in each part. The board serves it through its own gated route, never from an outside URL. It shows inline on the Design page and as a text link to Design everywhere else. Any other image source renders as plain text.

## fold.mjs API

```js
foldEvents(events, team) => {
  items:     [{ id, title, lane, owner, status, due, area, why, createdAt, updatedAt, createdBy, notes: [event], comments: [event] }],
  questions: [{ id, title, text, for, blocking, status: 'open'|'settled', askedBy, askedAt, answers: [event], settled: event|null }],
  decisions: [{ id, title, text, why, affects, status: 'proposed'|'accepted'|'rejected', proposedBy, proposedAt, resolved: event|null, comments }],
  gates:     [{ id, title, criteria, due, status: 'open'|'proposed'|'passed'|'failed', history: [event] }],
  sessions:  [{ id, by, agent, focus, repo, branch, startedAt, lastAt, endedAt, summary }],
  people:    [{ ...teamPerson, openItems: [id], openQuestions: [id], activeSession: id|null, lastSeenAt (latest event by the person; events `./hub setup` writes, agent `hub-setup`, do not count), pulses: [pulse] }],
  activity:  [event]            // newest first, everything except pulses
  pulses:    [{ id, by, agent, at, note, repo, branch, pushed, ahead, behind, files, pr, item }] // latest per person per repo, newest first
  overlaps:  [{ repo, file, people: [id], pulses: [{ by, branch, pushed, at, pr }] }] // files two or more people's pulses (under 4 hours old) both list
  rejected:  [{ file, reason }] // events that failed validation, shown on the board, never thrown
}
```

`validateEvent(obj, { teamIds? }) => { ok: true, event } | { ok: false, reason }` lives in `lib/hub/schema.mjs`. The human-only rule is enforced there: `decision.accept`, `decision.reject`, `gate.pass`, `gate.fail` with `via: "agent"` are rejected. When `teamIds` is given, `by` must be in it. Over-long `title` and `text` are clipped, not rejected.

Fold details (additive; the shapes above are the minimum):

- `foldEvents(events, team, { now? })`. `events` may be raw event objects or loader entries `{ file, event }` / `{ file, error }` from `loadEventsFromDir(dir)` in `lib/hub/load.mjs` (Node only; `loadBoard(root)` loads team and events and folds). `now` decides `session.idle`.
- Order is `at`, then `id`. An event whose ref is not created yet (clock skew between machines) is held and applied when the creating event arrives.
- Rejected also covers unreadable JSON, an `id` that differs from the file name, and duplicate ids.
- Extra fields: items `text`, `needs`, `blocker`, `links`, `history`; questions `answer` (settled text), `comments`; gates `text`, `addedBy`, `addedAt`, `comments`; sessions `idle`; top level `kb: [{ page, firstAt, lastAt, lastBy, changes }]`. A `note` on a non-item goes to that object's `comments`.

## Knowledge pages

Frontmatter then markdown:

```
---
title: The prompt
summary: what we are asked to build, and how it is judged
kind: brief | reference | idea | decision-log | person | research | how-to
updated: 2027-01-15
by: ada
sources: [sources/2027-01-15-kickoff.md]
---
```

Optional frontmatter keys: `summary:` (one line saying what the page answers; `./hub kb` shows it, falling back to the first line of prose) and `group:` (one of `rules`, `tracks`, `ideas`, `team`, `logistics`), which chooses the page's cluster on the home map; without it the slug decides. Keep each page under about 400 words and one topic. No wide tables; use short lists, which read on a phone. Link pages with `[[kb/slug]]`.

There is no index to append to: `./hub kb` builds the list of every page from the pages themselves, so two people adding pages at once never edit the same file. `kb/index.md` is the center of the map and a hand-kept guide to the starter pages; edit it only to change that guide. `kb/playbook.md` holds the schedule in two sections, `## Deadlines` and `## Calendar`, one line per entry: `- 2027-01-17T09:00-05:00 | Submissions due | kind: deadline`.

## The tool and git

- Every write is one commit of one event file (plus the knowledge page for `learn`, the images for `design`), pushed with `pull --rebase` and retries, never forced.
- The tool commits only when the hub folder is the top of its own git repo, and pushes only a branch origin already has. A hub folder inside another repo, or a local work branch, stays local.
- `./hub sync` exits 2 and says `Hub NOT synced` when local hub commits cannot reach origin (a conflict in a non-event file, a clone left mid-rebase or mid-merge, a failed push). `./hub doctor` reports the same as a `FIX`.
- The Claude Code hooks (`scripts/hooks/`) and `pulse --auto` act only in a real hub: `hub.repo` is set, the folder is the top of its own repo, and origin is `hub.repo`. Anywhere else they exit without running git. `HUB_HOOKS=off` turns them off on one machine.
