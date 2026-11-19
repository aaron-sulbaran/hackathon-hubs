# Working together in the project repo

How the team works in the project repo. Every agent follows this. The tool lives in the hub folder, so from a project clone it is called by its path: `<hub>/hub`, for example `../hub/hub` when the hub sits beside the clone.

1. **Pulse** when you start, when you switch branch, when you open a PR, when you merge, and at least every 15 minutes while working. The git hooks do most of it. Run it from inside the project clone, never the hub folder (it refuses there). When you start something, give one line of intent: `<hub>/hub pulse "<what and why>"`.
2. **Before touching a file outside your lane or a shared file,** read `<hub>/hub who` to avoid surprises, then go ahead. Your pulse lists the file, so people see it.
3. **Push your branch early.** A local-only branch is invisible to everyone.
4. **Pull:** rebase on main when `pulse` or `sync` says main changed your files, before you open or update a PR, and before you merge. Otherwise keep working; do not rebase for every commit on main.
5. **PR:** open one when checks are green. Keep it small. Its description names the hub item.
6. **Merge:** you merge your own PR when checks are green, whatever files it touches. If two changes collide, fix it on main once both are in. Use "Rebase and merge" or "Squash and merge" (both keep the author's credit). After merging, `<hub>/hub pulse` so others pull, and `<hub>/hub done` if the item is finished.
7. **The hub is a tool, not a relay.** Do not copy into it what git, a PR, or a knowledge page already holds: link it. One line per note. Read `<hub>/hub who` and what `sync` prints for you, not the whole feed.
8. **Commits carry their author's own identity.** Never commit as another teammate or as a bot. `<hub>/hub doctor` in the clone checks it and the pre-push hook enforces it.

Lanes: the project `AGENTS.md` table, copied in `LANE_TABLE` (`scripts/team-git.mjs`); change both together. Setup per clone: from the hub, `node scripts/install-hooks.mjs <clone>`, then `<hub>/hub doctor` in the clone.

## A day

Grace's agent starts the search filters.

```
$ git switch -c grace/search-filters
$ ../hub/hub pulse "Filters on the search page: by date and by place"
Pulse sent (grace/search-filters, 0 files, local).
Local only: push the branch so teammates can see it.
```

It pushes after its first commit. Later Ada's agent edits the search page too; its next `pulse` or `sync` prints:

```
grace is editing app/search/page.tsx on grace/search-filters (pushed, 6m ago). Pull before you push.
Rebase now: main changed 1 of your files (package.json).
```

Ada's agent keeps going and rebases on main; whoever merges second fixes any collision on main. Grace's checks go green; her agent opens PR #7 naming `t-a3f9` and pulses:

```
PR #7: merge it when your checks pass.
```

Had it touched `package.json`, it would say to merge and say so in the pulse so others pull. The agent squashes and merges, pulses, and runs `../hub/hub done t-a3f9 --link <PR url>`.
