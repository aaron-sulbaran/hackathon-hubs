# Team hub

Our team's private hub for this hackathon. The event's name, dates, and time zone are in `hub.config.json`; the people are in `team.json`. Each of us runs a coding agent. Every agent reads this hub before it acts and posts what it did, so no two agents build the same thing or edit the same file at once. You watch it on the board and step in only where a person is needed.

The product lives in a separate repo. Its link goes in `kb/project-repo.md` once it exists.

## The team

Everyone is listed in [team.json](team.json): their id (what you type in commands and `@mentions`), name, and focus. The board's "Who is on what" shows the same people.

## Get on it (one paste, about five minutes)

1. **Accept the GitHub invite** to this repo (your email or github.com/notifications). No invite yet? Send the hub owner your GitHub username.
2. **Paste one prompt** into your coding agent (Claude Code, Cursor, Codex, anything that runs commands): the box in [docs/agent-prompt.md](docs/agent-prompt.md). It asks you which teammate you are, sets everything up, and checks off your first task. The board's home page has a Copy prompt button for the same text.
3. **Open the board** with the unlock link the hub owner sent (once per device), then tap your name in the top right. Anything you do on the board is signed with it.

By hand instead: [docs/setup.md](docs/setup.md). Setting up a new hub (the owner, once): `./hub setup`, see [docs/owner-checklist.md](docs/owner-checklist.md).

## What your agent does, and what needs you

Your agent syncs with the hub, pulses the files it is about to touch (that is what warns two people off the same file), and posts one line notes with a link. It builds, pushes, and merges without waiting for anyone. Lessons go in small pages under `kb/`.

What needs you shows up under **Needs you** on the home page: questions asked of you or the whole team. Anything on your own accounts or involving secrets also needs you; nothing else does.

## The board

| Page | What it is for |
|---|---|
| Home | The map of everything we know, time left to submit, what needs you, and who is on what |
| Board | Every task by lane, and the latest posts |
| Schedule | The event as an itinerary, in the event's time zone |
| Knowledge | The same map with every page listed by area; each page opens in full |

## Commands you might type

Run these from the hub folder. Your agent runs everything else. On Windows without Git Bash or WSL, type `node scripts/hub.mjs <command>` wherever this page says `./hub <command>`; the tool needs Node 20.9 or newer and git, on macOS, Linux, or Windows.

| Command | What it does |
|---|---|
| `./hub status` | Who is on what, open tasks, questions, deadlines |
| `./hub who` | Who is on which branch and files right now |
| `./hub kb` | Every knowledge page with a one line summary |
| `./hub ask "<question>" --for <id>` | Ask a teammate (or `--for team`) |
| `./hub doctor` | Check this machine's setup; every line should say `ok` |

## Where things live

```
README.md        this page
AGENTS.md        the rules every agent follows
hub.config.json  the event: name, time zone, dates, repo
team.json        the people
kb/              our knowledge pages (start at kb/index.md; ./hub kb lists them all)
events/          the record of everything anyone did (written by ./hub, never edited)
sources/         the official event documents and raw notes, kept as is
design/          images: design reviews, references, mockups
docs/            setup, the agent prompt, the data contract, deploy notes, design
hub              the tool (./hub; node scripts/hub.mjs on Windows)
app/ components/ lib/   the board's code
```

## If something goes wrong

Run `./hub doctor` first. Each `FIX` line says what fixes it.

| You see | Do this |
|---|---|
| `Identity not set` | `./hub me <your id>` |
| `NOT pushed` | `./hub sync`. Still failing? `./hub doctor` |
| `Hub NOT synced` | Your hub writes are stuck on this machine. Do what the message says (usually: two people edited the same knowledge page; keep both changes, then `./hub sync`) |
| `remote reachable: FIX` | Accept the GitHub invite, then `gh auth login` on your own computer, or the `HUB_GIT_TOKEN` secret on a cloud agent ([docs/setup.md](docs/setup.md)) |
| `hub config: FIX` | The owner has not run `./hub setup` yet, or `hub.config.json` is broken |
| `permission denied: ./hub` | `chmod +x hub`, or `node scripts/hub.mjs <command>` |
| The board shows a blank 404 | Open the unlock link again on this device |
| "Saving from this page is off" on the board | The board cannot write yet; your agent's `./hub` commands still work |

Running or deploying the board: [docs/deploy.md](docs/deploy.md). Pushing to this repo never deploys the board; `./hub setup --deploy` does.

## Claude Code hooks

Opening Claude Code in this folder runs the hooks in `.claude/settings.json`: at session start and at most every 3 minutes per prompt it syncs the hub (pull, then push this machine's waiting hub commits on `main`); at stop it sends a pulse and reminds the agent once to post. They act only in a real hub (`hub.repo` set in `hub.config.json`, this folder the top of its own git repo, and origin equal to `hub.repo`), never push a branch origin does not have, and do nothing anywhere else. To turn them off on one machine, set `HUB_HOOKS=off`.

## License

MIT, in [LICENSE](LICENSE).
