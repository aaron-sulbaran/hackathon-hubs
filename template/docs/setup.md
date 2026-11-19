# Setup (about five minutes)

For a teammate joining a hub someone already set up. (Setting up a new hub is `./hub setup`, in [owner-checklist.md](owner-checklist.md).)

The fastest path: open your coding agent and paste the prompt in [agent-prompt.md](agent-prompt.md). It does every step below and tells you what it needs from you. This page is the same thing by hand. Below, `<owner>/<name>` is the hub repo (`hub.repo` in `hub.config.json`, and in the message the owner sent you), and `~/<slug>` is the event's slug from `hub.config.json` (`event.slug`), the folder the onboarding prompt uses too. On Windows without Git Bash or WSL, type `node scripts/hub.mjs <command>` wherever this page says `./hub <command>`.

## On your own computer (any agent)

1. **Check Node first.** `node --version` must print v20.9.0 or newer; older versions crash the tool. Older or missing: `brew install node` on a Mac, or `nvm install 22 && nvm use 22`. `git --version` must work too.
2. **Get access.** Accept the GitHub invite to the hub repo (your email or github.com/notifications). No invite? Send the hub owner your GitHub username.
3. **Clone the hub.**
   ```bash
   mkdir -p ~/<slug> && git clone https://github.com/<owner>/<name>.git ~/<slug>/hub && cd ~/<slug>/hub
   ```
   If git says the repo is not found, GitHub does not know this computer is you: run `gh auth login`, then clone again.
4. **Say who you are.** `./hub me <id> --agent <tool>`, with your id from `team.json` and your agent's name (`claude-code`, `cursor`, `codex`). It stays on this machine in `.hub-me`.
5. **Check everything.** `./hub doctor`. Every line should start with `ok`; each `FIX` line says what fixes it.
6. **Make it stick.** Save the short rule in [standing-instruction.md](standing-instruction.md) where your agent keeps instructions between sessions; that page lists the place for each agent. Claude Code needs nothing: its hooks are already in the hub, so open your sessions in the hub folder.
7. **Prove the round trip.** `./hub onboarded "<tool> (LOCAL)"`. It should print `Pushed.`, and your "Connect your coding agent" task on the board turns done.

## When the project repo exists

The product lives in its own repo, separate from the hub. Many events require a new public repo created during the event; `kb/rules.md` says what yours requires. Its URL goes in `kb/project-repo.md` the moment it exists. Then:

1. Clone it beside the hub: `git clone <url> ~/<slug>/project`.
2. From the hub: `node scripts/install-hooks.mjs ~/<slug>/project`. The git hooks pulse your branch and files after each commit, and refuse a push from a bot or a teammate's identity. Claude Code users reopen Claude Code afterwards.
3. Inside the clone: `~/<slug>/hub/hub doctor`. It sets the clone's commit identity to your name and the `commitEmail` the hub has for you in `team.json` (your GitHub no-reply address), so your commits count for you. If team.json has no `commitEmail` for you, doctor says so: ask the owner to add it, or set `git config user.email` in the clone yourself.

## Cloud agents

A cloud agent gets a new machine every session: the clone, `.hub-me`, and any git login are gone each time. Three things replace them, each set up once:

1. **A token so the machine can push.** Save a personal secret named `HUB_GIT_TOKEN` in the agent's settings, holding the token the hub owner sent you. Never paste it in chat or into a file in this repo.
2. **Identity from the environment.** With no `.hub-me`, the tool reads `HUB_ME` (your id) and `HUB_AGENT` (your agent's name) from the environment. They are not secret.
3. **A saved instruction that rebuilds the rest.** The block in [standing-instruction.md](standing-instruction.md) with its cloud part clones the hub (and the project repo once it exists), logs git in with the token, and sets the identity. Save it where it loads every session.

## If something goes wrong

| You see | Do this |
|---|---|
| `Identity not set` | `./hub me <id>`, or on a cloud agent set `HUB_ME=<id>` |
| `NOT pushed` | `./hub sync`. Still failing: `./hub doctor` and fix what it lists |
| `Hub NOT synced` | Local hub commits cannot reach origin. Do what the message says; most often two people edited one knowledge page, so keep both changes and `./hub sync` |
| `remote reachable: FIX`, or the clone says not found | Accept the invite at github.com/notifications, then `gh auth login` (or the `HUB_GIT_TOKEN` secret on a cloud agent) |
| `push permission: FIX` | You can read but not write: accept the invite, or ask the hub owner for write access |
| `hub config: FIX` | `hub.config.json` is missing or broken. The owner runs `./hub setup`; everyone else runs `./hub sync` |
| `permission denied: ./hub` | `chmod +x hub`, or run `node scripts/hub.mjs <command>` |
| Claude Code hooks seem silent | Reopen Claude Code in the hub folder; hooks load only at session start |
