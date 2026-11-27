# hackathon-hubs

An open source hackathon hub: one private repo plus a web board that a hackathon team's coding agents read before they act and post to after, so no two agents build the same thing or edit the same file at once. It is for any team that runs coding agents at a hackathon. What makes it different: no database and no accounts. The state is small append-only JSON files in the team's own git repo, and the goal is a setup that takes a couple of clicks. This repo is public; it may get its own website later.

## Where things live

- Live state, what's next, and decisions waiting on the owner: the maintainer's private board, which is not in this repo
- Public discussion: GitHub issues and pull requests
- Production: none · Deploy: none · Logs: none

## Living document protocol

Claude Code loads this file into every session in this repo, subagents included, so every line is paid for on every run. It holds only what an agent cannot learn from the code and what will still be true next week.

**Every checkout has this file.** AGENTS.md is tracked in git, so every worktree and every branch carries it. Read and edit the copy in your own checkout, never another checkout's; your edit merges with your branch.

**Two layers, two owners.** Layer 2, facts, belongs to the agents: invariants, gotchas, how to run and deploy, a short map. Agents rewrite it in place, without asking, whenever their work makes a fact new, wrong, or different, and commit that edit on its own (`docs(agents): <what changed>`). Layer 1, rules, is the owner's: the stage, conventions, scope guardrails, tooling and roles. A substantive Layer 1 change (stage, scope, a convention, a new rule) is proposed once, as one diff: on the maintainer's board, or by an outside contributor in a pull request. Layer 1 housekeeping is applied directly and noted on the board or in the pull request. Housekeeping means a rule that names a tool, skill, path, or command that no longer exists, a rule that contradicts how the repo verifiably works, or writing down a decision the owner already made (with its date). Git history is the review trail.

**Approved means applied.** Once the owner says yes, the agent applies the change itself and commits it. Never ask the owner to run an edit, and never ask for approval of the same change twice. If you can't apply it from where you are, hand it to the lead session that can, with the approval attached. If Claude Code's permission system refuses an AGENTS.md edit (in auto mode its classifier can call it self-modification), that is a permission decision: never work around it; report the blocked edit in one line and move on.

**Never in this file:** build status, in-flight work, PR lists, rankings of what's next, dated changelogs. They go stale within a day. Live state goes on the board; history is git and the PRs.

**Rewrite, don't append.** A fact that stopped being true is deleted, not struck through. A fact that changed is edited where it stands. Over budget means cutting the least load-bearing line.

**Budgets.** Whole file under 20,000 characters, Layer 2 under 6,000. Run `wc -c AGENTS.md` before any edit that grows it.

**Drift.** Code that contradicts a Layer 2 fact: fix the fact in the same session. Code that contradicts a Layer 1 rule: stop and tell the owner; never work around a rule silently.

**Last verified.** Layer 2 ends with `Last verified: YYYY-MM-DD at <short commit>`. Update it whenever you check Layer 2 against the code, even if nothing changed.

**Stage.** Layer 1 names the stage (sketch, pilot, or live) and its bar. Match your rigor to it. Before building on any of these, stop and propose a stage change: the first user outside the team, a real bank, payment, or credential flow, storing personal data (emails count), a store listing or public launch, anything regulated.

# Layer 1: Rules (the owner's)

Stage: pilot (set 2026-11-26, the repo is public)
A PR per change with CI green before merge. Second-model review on anything touching auth, money, personal data, migrations, or permissions. Migrations reviewed before they apply, with a way back. Errors reach the owner (monitoring, or logs someone reads daily). A written rollback, and a way to delete one user's data. Never test against real users' data.

## Stack

Inherited from the hub this was extracted from, not chosen fresh: Next.js 16, React 19, Tailwind 4, zod, vitest, pnpm. The hub command line tool is plain Node with no dependencies.

## Conventions

The maintainer's global rules apply. None specific to this repo yet.

## Scope guardrails

- This repo is public: every commit is public and permanent (decided 2026-11-18). Commits use a GitHub noreply address. The pre-push scrub check must pass before any push (turn it on with `git config core.hooksPath .githooks`), and nobody bypasses it with `--no-verify`.
- The template was extracted from private hubs that are not part of this repo. They, and the maintainer's private notes, are read-only: never delete or change anything in them; read only, and write only to this project.
- Nothing private goes in a tracked file: no teammate names, emails, tokens, unlock links, or details of the products built at past events.

## Tooling and agents

- The lead session orchestrates, on Opus since 2026-11-26 (the owner's choice); it does not do the work itself. Basic work goes to Opus or Sonnet subagents. Long running work, and work the owner will want to steer directly, goes to worktrees.

## Commands

None that differ from the obvious yet.

# Layer 2: Facts (agent-maintained)

## Invariants

- `template/` is the hub a team receives. It must run on its own: its own `package.json` and lockfile, never a workspace member, no imports from outside `template/`.
- Everything specific to an event lives in `template/hub.config.json`; everyone on the team lives in `template/team.json`. `template/lib/hub/config.mjs` reads and validates the config. Hard-coding an event name, date, time zone, base path, or repo elsewhere brings back the problem this repo removes.
- `template/lib/hub/*.mjs` and everything under `template/scripts/` import Node built-ins only. Teammates run `./hub` before any install. Root `scripts/` is the same.
- `template/vercel.json` turns off deploys from git pushes. A hub makes about 1,000 commits a day; Vercel's free plan allows 100 deployments. Deploys are `vercel deploy --prod`, which `./hub setup --deploy` runs.
- Setup hands secrets to child processes on stdin only: never argv, output, a commit, or a tracked file. `template/tests/hub/setup-test.mjs` asserts it.

## Gotchas

- `.private/` is gitignored and local to the maintainer.
- `scripts/scrub-check.mjs` is the scrub check (`--tracked`, or `--pre-push` from `.githooks/pre-push`). Its private terms file is `$SCRUB_TERMS`, else `.private/scrub-terms.txt` in the main worktree; `!` lines are allowed terms. CI runs the built-in checks only. A `scrub-check: allow` line skips them. Pre-push checks emails (noreply only), ref names, and every commit against each parent, binaries included; a file over 5 MB needs `SCRUB_ALLOW_LARGE`. What it cannot vouch for exits 2 (`git fetch` first).
- The global git email may not be noreply. In a fresh clone, run `git config user.email <login>@users.noreply.github.com` (the login-only form; the private terms block the numeric-id form) and `git config core.hooksPath .githooks` before the first commit. Linked worktrees share both.
- `packages/create-hackathon-hub/template/` is a copy of `template/` made at pack time, gitignored and removed after packing. Never edit it. Packing needs a git checkout: it bundles only tracked `template/` files, plus the root LICENSE.
- After routes move, a stale `template/.next` breaks `pnpm typecheck` with missing-module errors. Delete `template/.next` and rerun.
- Every board page that shows team data lives under `template/app/(hub)/`, whose layout checks the unlock cookie. A route handler that serves team data calls `requestAllowed` from `lib/web/gate.ts`. The root layout and 404 page carry none.
- The shipped Claude Code hooks and `pulse --auto` act only in a real hub (`hub.repo` set, its own git repo, origin matches); here they do nothing, by design.
- Pull requests merge by fast-forward from a local clone (`git switch main`, `git merge --ff-only <branch>`, `git push origin main` through the hook); GitHub records them as merged. The merge button writes a commit under whatever email the account settings pick: do not use it.
- Worktree agents are cut from `origin/main`, not local main. Push main before dispatching one, or tell it to reset to main first.
- Never run `./hub setup` or the scaffolder here without `--dry-run`, or `--skip-github --skip-vercel --skip-tokens`. With `gh` and `vercel` logged in, a plain run creates a real repo and a real deploy.
- Setup has run once for real (gh 2.103, Vercel CLI 65.2, a one-person team) against an untracked test hub: repo, project, deploy, board check, and a no-change rerun all worked. Still unproven for real: invites to other people, `--tokens`, and a machine where git has no GitHub credential helper.
- Setup prints the unlock link only on a terminal without `--yes`. Otherwise (agent, pipe, log) it writes the link to the gitignored 0600 `.hub-owner.local` and prints only that path; `--print-link` forces printing. Tests that need the printed link pass `--print-link`.
- The board reads `hub.basePath`, `event.timezone`, and the repo fallback at build time (`template/next.config.ts`), so changing them needs a redeploy. Names and dates are read at run time.
- `template/docs/agent-prompt.md` is generated from `docs/agent-prompt.template.md` by setup. Edit the template; a test fails if the committed render drifts from the config.
- `next dev` rewrites a block it manages inside `template/AGENTS.md`, between the `nextjs-agent-rules` markers. Leave it alone; its em dashes are Next's.

## Run and deploy

- Template checks, from `template/`: `pnpm install`, `pnpm typecheck`, `pnpm test:all`, `pnpm build`
- Tool tests alone: `node --test template/tests/hub/*-test.mjs` (use the glob; a bare folder fails on Node 24)
- Scaffolder tests: `node --test "packages/create-hackathon-hub/test/*.test.mjs"`
- Scrub check: `node --test scripts/scrub-check.test.mjs`, then `node scripts/scrub-check.mjs --tracked`
- Checks need Node 22.12 or later (the web test runner); the hub tool itself targets Node 20.9
- A populated board to look at, from `template/`: `HUB_LOCAL_DIR=tests/fixtures/demo-hub pnpm dev`
- The whole flow: `node packages/create-hackathon-hub/index.mjs <scratch folder> --no-setup`, then `./hub setup` there with the skip flags
- CI: `.github/workflows/ci.yml` runs the template checks, the scaffolder tests, the scrub check, and a scaffold-then-build smoke test
- Board variables: `HUB_KEY`, `HUB_REPO`, `HUB_READ_TOKEN`, `HUB_WRITE_TOKEN` (one token set as both is the default), `HUB_LOCAL_DIR`

## Map

- `template/` the hub: `app/` and `components/` the board, `lib/web/` its server code, `lib/hub/` schema, fold, and config shared with the tool, `scripts/hub.mjs` the tool, `scripts/setup.mjs` setup, `kb/` starter pages, `docs/` what a team reads, `tests/fixtures/demo-hub/` the sample hub the tests seed from
- `packages/create-hackathon-hub/` the scaffolder behind `pnpm create hackathon-hub`
- `scripts/` repo tooling: the scrub check; `.githooks/` its pre-push hook
- `docs/` playbook and how it works
- `.github/` CI and issue forms

Last verified: 2026-11-26 at 881b29f
