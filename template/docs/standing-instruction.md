# Standing instruction

The short rule every teammate's agent keeps between sessions, so the hub protocol fires even when no hook does. The onboarding prompt (`agent-prompt.md`) tells the agent to save it. Replace `<HUB>` with the full path of the hub clone, `<EVENT>` with `event.name` from `hub.config.json`, and `<owner>/<name>` with `hub.repo`.

## The block

```text
Team hub rule (<EVENT>). Our agents coordinate only through the hub repo at <HUB> (github.com/<owner>/<name>). Its AGENTS.md is the contract. In every session, in any repo:
1. Start with `<HUB>/hub sync`, then `<HUB>/hub status`. Sync about every 15 minutes.
2. Before editing in the project repo, pulse the files you will touch: `<HUB>/hub pulse "<what and why>"`. It prints any overlap with a teammate; read `<HUB>/hub who`, then go ahead.
3. Post one line notes with a link as you go: `<HUB>/hub note "<what changed>" --ref <t-id>`. Push your branch early; merge your own PR when checks are green; pulse again.
4. Commit only as your person, never as a bot or a teammate; run `<HUB>/hub doctor` in each clone.
5. A lesson worth keeping goes in a small knowledge page: `<HUB>/hub learn kb/<slug>.md "<what changed>"`.
6. Once the project repo exists (its URL is in <HUB>/kb/project-repo.md), clone it beside the hub and run `node <HUB>/scripts/install-hooks.mjs <that clone>`.
```

## Cloud agents add this on top

For an agent whose machine is rebuilt for each session (a cloud agent in the browser). Nothing on disk survives, so the saved instruction also rebuilds the clones and carries the identity. Replace `<id>`, `<tool>`, `<owner>/<name>`, and `<DIR>`: the folder that holds the hub clone, the same one onboarding used (the prompt clones to `~/<event.slug>/hub`, so `<DIR>` is `~/<event.slug>`, for example `~/sample-hackathon`). `HUB_GIT_TOKEN` is the name of a saved secret; its value is never written here.

```text
This machine is rebuilt every session, so before the hub rule, run this (bind the saved secret HUB_GIT_TOKEN to it):
  export HUB_ME=<id> HUB_AGENT=<tool>
  if [ -n "$HUB_GIT_TOKEN" ]; then git config --global credential.helper store; printf 'https://x-access-token:%s@github.com\n' "$HUB_GIT_TOKEN" > ~/.git-credentials; chmod 600 ~/.git-credentials; fi
  [ -d <DIR>/hub ] || git clone https://github.com/<owner>/<name>.git <DIR>/hub
  PROJECT=$(grep -o 'https://github.com/[A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*' <DIR>/hub/kb/project-repo.md | head -1)
  if [ -n "$PROJECT" ] && [ ! -d <DIR>/project ]; then git clone "$PROJECT" <DIR>/project && node <DIR>/hub/scripts/install-hooks.mjs <DIR>/project; fi
  [ -d <DIR>/project ] && (cd <DIR>/project && <DIR>/hub/hub doctor)
Set HUB_ME and HUB_AGENT on every hub command; there is no .hub-me file here. <HUB> is <DIR>/hub, the folder this block clones. `hub doctor` in the project clone sets its commit identity to your person's name and GitHub no-reply address from team.json, so commits credit their account and never the agent's bot account.
```

## Where to save it

| Agent | Where it goes | Who does it |
|---|---|---|
| Claude Code | Nowhere. The hub's hooks are in the repo (`.claude/settings.json`) and `AGENTS.md` loads on its own. Open sessions in the hub folder until the project repo exists; step 6 installs the hooks there. | nobody |
| Cursor | Settings, Rules, User Rules | the person pastes it |
| Codex | `~/.codex/AGENTS.md` | the agent, after asking |
| A cloud agent in the browser | Its personal instructions or skill that load in every session. Save the block plus the cloud part. | the agent if it can, else the person |
| Anything else | Its always-on rules or memory. If it has none, paste the block as the first message of each session. | the person |

Every agent also puts the block at the top of the project repo's `AGENTS.md` once that repo exists, so the rule travels with the code.
