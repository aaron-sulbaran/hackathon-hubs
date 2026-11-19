# Team hub: read this first

The people on this team are in `team.json` (ids, names, focus); each runs their own coding agent at the event named in `hub.config.json` (`event.name`, with its dates, `event.submitBy`, and time zone). Agents never talk to each other directly. They coordinate only through this hub: read it before acting, write what you are doing. Skip the hub and another agent will duplicate or break your work.

**What this repo is:** the hub: append-only events, the knowledge pages (`kb/`), raw sources, the tool (`./hub`), and the board (the web app).
**What it is not:** the product. The hackathon project lives in its own repo; when it exists, its URL is in `kb/project-repo.md`. Never put product code in this repo. Many events require the project repo to be new, public, and written during the event: `kb/rules.md` says what this one requires.

# Layer 1: rules (set by the team; agents do not edit)

- **Stage: sketch.** Private, one weekend, a small team. Speed over polish.
- **No secrets, ever,** in events, kb, or code: no keys, tokens, phone numbers, or booking details. Name a variable, never its value.
- **How decisions work** (below): build, push, and merge without waiting for anyone.
- **`sources/` is immutable.** Add new raw files; never edit or delete one. Never read `sources/` wholesale; open the one file a knowledge page cites.
- **Events are append-only.** Write them only through `./hub`. Never edit or delete a file in `events/`.
- **Never force-push,** here or in the project repo.
- **Pulse your files.** In the project repo, pulse the files you will touch before editing (step 3 of the working loop), and again when your change is pushed or merged, so others see it. Work on your own branch: the hub is where incoming changes are visible, so merges line up.
- **The hub is a tool, not a relay.** Do not copy into it what git, a PR, or a knowledge page already holds: link it. One line per note. Read `./hub who` and what `sync` prints for you, not the whole feed.
- **Commits carry their author's own identity.** Never commit as another teammate or as a bot. `./hub doctor` checks it and the pre-push hook enforces it.
- **No status, plans, or what's next in this file.** See "Current progress" below.
- **Plain language.** Write so a teammate's agent with no context understands. No em dashes, no emoji.

## How decisions work

**Build, push, and merge without waiting for anyone.** No sign-off is needed for design, architecture, features, dependencies, shared files, or scope. If two changes collide, fix it on main once both are in.

- A big call (a design direction, a new dependency, a feature in or out) gets one line on record: `./hub propose "<what>" --why "<why>"`. It is a record, not a request. Keep building. Anyone who disagrees says so on the board or changes the code.
- Keep main running: run the checks before you push; if you break main, fix it before anything else.
- Still needs that person: creating a paid service or anything on someone's own account, and anything involving secrets.
- There are no sign-offs. The `accept`, `reject`, and `gate` commands exist in the tool for people who want them; nobody needs them.

# Layer 2: how it works (agents keep this accurate)

## Where to start (arriving cold)

1. `./hub sync`, then `./hub status`. Identity not set: ask your person which teammate they are, then `./hub me <id>` (or set `HUB_ME` and `HUB_AGENT`). Not onboarded: run `docs/agent-prompt.md`. On Windows without a POSIX shell, every `./hub <command>` is `node scripts/hub.mjs <command>`.
2. Read `kb/index.md`, `kb/rules.md`, `kb/tracks.md`, then only the knowledge pages your task touches. `./hub kb` lists every page with its summary, including ones added since. Answer what you can in `./hub status --mine`.
3. The project repo is in `kb/project-repo.md`. Find your work on the board, and claim it or add it with `--claim`.

## Current progress

It lives in `./hub status`, `./hub who` (who is on which branch and files), the board, and `kb/`. Detail: `./hub show <id>`. The schedule is `kb/playbook.md`.

## The working loop (every session, unprompted)

1. **Sync.** `./hub sync`, `./hub status`. If AGENTS.md or `docs/CONTRACT.md` changed, re-read them. `Hub NOT synced` means your hub writes are stuck on this machine: do what it says before anything else.
2. **Claim before working.** In flight with someone else: pick something else or `./hub ask "<q>" --for <them>`. Otherwise `./hub claim <t-id> --why "<why>"` or `./hub add "<title>" --why "<why>" --claim`. Build only after it prints `claimed by <you>` and exits 0; if it says someone else claimed first, pick something else.
3. **Announce.** In the project clone: `<hub>/hub pulse "<what and why>"`, with `<hub>` the path to this hub (for example `../hub/hub pulse`). It posts your branch and files, and prints any overlap. Or `<hub>/hub note "Starting: <change>" --ref <t-id> --files <a,b>`. Read `<hub>/hub who` to avoid surprises, then go ahead; touching a shared file or another lane's folder needs a pulse so people see it, not permission.
4. **Pulse, push, PR, merge** by `docs/working-together.md`: pulse at start, branch switch, PR, merge, and every 15 minutes (hooks do most); push early; rebase when `pulse` or `sync` says main changed your files, and before a PR or merge; merge your own PR when checks are green, whatever files it touches, then pulse.
5. **Need something only another person can give** (their account, a secret): `./hub ask "<q>" --for <id>|team` (`--blocking <t-id>`), or `./hub block <t-id> "<need>" --needs <id>`. For everything else, decide and keep going.
6. **Answer what you can:** `./hub answer <q-id> "<answer, with the file or page>"`. The asker settles it.
7. **Durable lesson?** Write a small knowledge page with a `summary:` line in its frontmatter, then `./hub learn kb/<slug>.md "<what changed>"`. No index to edit.
8. **Big call?** `./hub propose`, keep building.
9. **Finished.** `./hub done <t-id> --link <PR, commit, or page>`, then one `./hub note` saying what shipped and what is left.

Every write prints its id, commits as you (team.json `commitEmail`), and pushes, retrying on races; a failed push stays local until `./hub sync` gets it out. `./hub help <command>` explains any command.

## The project repo

Clone it beside the hub, then from the hub: `node scripts/install-hooks.mjs <clone>` (any agent: git hooks pulse in the background after commit and checkout, and pre-push refuses bot, placeholder, or teammate identities; Claude Code hooks too). Rerun after hub updates. Then `<hub>/hub doctor` in the clone; `<hub>/hub credit` there lists who GitHub will credit. Run hub commands from inside the clone as `<hub>/hub ...` so repo and branch fill in. The hub says why and who; git says what. If the clone's `AGENTS.md` lacks the block in `docs/standing-instruction.md`, add it at the top.

## Conventions

- **Ids:** prefix plus 4 base36 chars: `t-` item, `q-` question, `d-` decision, `g-` gate, `s-` session.
- **Links:** `[[t-a3f9]]`, `[[kb/rules]]`, `@grace` (any id from `team.json`).
- **knowledge pages:** frontmatter with a one line `summary:` (see `docs/CONTRACT.md`), one topic, under about 400 words. `./hub kb` lists them from that frontmatter; `kb/index.md` is a hand-kept guide to the starter pages, not a list to append to. No wide tables: they are unreadable on a phone; use short lists. An optional `group:` key (rules, tracks, ideas, team, logistics) picks the page's cluster on the home map; otherwise the slug decides.
- **Times are in the event's zone** (`event.timezone` in `hub.config.json`). `--due` takes `2027-01-17T13:30`, `"2027-01-17 1:30 pm"`, a bare date (23:59 that day), or a time with its offset; no offset means the event's zone, and the tool stores the offset. `HUB_TZ` changes only how times are shown. Titles over 140 characters are clipped; detail goes in `-m`.
- **Design feedback:** `./hub design <image> "<title>" -m "<notes>"` (webp, png, jpg; 600 KB max) copies it to `design/review/` and asks a `Design review:` question; answers are the feedback, settling resolves it. Reference images in `design/reference/` get a `sources.md` beside them with each file's URL and date.

## Map

```
hub.config.json       the event: name, slug, time zone, start, submit deadline, repo, base path, owner
team.json             the people: ids, names, GitHub ids, commit emails
docs/CONTRACT.md      binding data contract: config, event types, fold output, kb format
docs/working-together.md  pulse, pull, PR, and merge rules with a worked day
docs/agent-prompt.md  the onboarding prompt (rendered by ./hub setup; docs/setup.md is the same by hand)
docs/standing-instruction.md  the short rule each agent saves
docs/owner-checklist.md, docs/deploy.md  owner setup; running the board
docs/prompt-handoff.md  template for handing a task to a teammate's agent
events/YYYY-MM-DD/    one JSON file per action (append-only, written by ./hub)
kb/  design/  sources/   knowledge; images; raw notes (immutable)
hub, scripts/hub.mjs  the tool (Node 20+, no dependencies; node scripts/hub.mjs on Windows); scripts/team-git.mjs identity, credit, pulse data, lane table
scripts/setup.mjs     ./hub setup: config, team, repo, invites, deploy
scripts/hooks/        Claude Code hooks; scripts/install-hooks.mjs installs them and the git hooks
lib/hub/              schema.mjs, fold.mjs, config.mjs (shared with the board), load.mjs
app/ components/ lib/web/   the Next.js board
tests/hub/ tests/web/ CLI and board tests (pnpm test:all); tests/fixtures/demo-hub is a sample hub
```

## Any agent, with or without hooks

The working loop is the contract; nothing depends on hooks. Sync at start and about every 15 minutes. Each agent keeps `docs/standing-instruction.md` wherever its tool stores instructions. Claude Code gets hooks from `.claude/settings.json` (sync at start, at most every 3 minutes per prompt, a pulse and one reminder at stop). The hooks act only in a real hub: `hub.repo` set, this folder the top of its own repo, origin equal to `hub.repo`; anywhere else they do nothing. `HUB_HOOKS=off` turns them off on one machine. Cloud agents rebuild each session: the saved rule clones the hub, sets `HUB_ME`, `HUB_AGENT`, and the git identity, and logs in with `HUB_GIT_TOKEN` (`docs/setup.md`).

## Gotchas

- Pushing never deploys the board (`vercel.json` turns git deployments off; a hub makes too many commits for Vercel's daily limit). Deploy with `vercel deploy --prod` (`docs/deploy.md`), and only for app code or a `basePath` or `timezone` change.
- With the token set on the deployment (one token as both `HUB_READ_TOKEN` and `HUB_WRITE_TOKEN`, from `./hub setup --tokens`), data commits reach the board in about 30 seconds with no deploy. Without one, the live board shows the `events/` and `kb/` files bundled into its last deploy, and saving from the board is off.
- Identity is per machine in `.hub-me` (gitignored); env `HUB_ME`, `HUB_AGENT`, `HUB_VIA` override it. Hub commits are authored with the person's `commitEmail` whatever the git config says.
- Pulses are state, not history: the fold keeps the latest per person per repo, overlaps ignore pulses over 4 hours old, and neither `feed` nor the web feed shows them. `pulse` re-sends at most every 5 minutes unless given a message; fetches at most every 2.
- `claim` refuses an item someone else has in flight; `--take` only after they agree. Two claims at once: the first wins, and the other agent is told and keeps nothing (`docs/CONTRACT.md`).
- `hub learn` commits only the named knowledge page. Other hub edits: commit them yourself, then `./hub sync`. Two people editing the same knowledge page at once is the one way to get a git conflict here; sync and doctor say so and print the fix.
- The tool never pushes a branch origin does not have, and never commits from a hub folder that sits inside another repo. Keep the hub clone on `main`.
- One clone, several agents: the tool serializes git work with `.git/hub-cli.lock`.
- Onboarding is one item per person with area `onboarding`, which `./hub setup` creates, found by area and owner (`./hub onboarded` checks yours off). The board copies the fenced `text` block of `docs/agent-prompt.md`, so editing it needs no deploy.
- The board leaves out events listed in `lib/web/withdrawn.ts` (text that should never have been posted); the files stay in `events/` and the tool still shows them. Adding one is a code change and needs a deploy.
- The pitch script page (`/script`, linked from Board) reads the json block in `kb/pitch-script.md` (a data commit, no deploy). Lines saved on the page are `script.edit` events that win per cue until reverted there. If the block does not parse, the page shows its built-in copy (`lib/web/pitch-script-default.ts`) with a warning. Its clock is shared: presses are `script.clock` events served fast by `/api/clock` from memory.
- Questions titled `Mentor question:`, `Sponsor question:` or `Organizer question:` show as one list, ordered by the `[[q-xxxx]]` lines under "Questions to ask" in `kb/mentor-questions.md`.
- Board pages live under `app/(hub)/`. A page that shows team data stays in that group, and a new route handler that serves team data must call `requestAllowed` from `lib/web/gate.ts`.
- Board: Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` first. If `hub.basePath` is set, the board lives under it (`lib/web/base-path.ts`): use `withBasePath()` for `fetch`, plain `<a>`/`<img>`, and rendered markdown; redirects send a path-only `Location`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
