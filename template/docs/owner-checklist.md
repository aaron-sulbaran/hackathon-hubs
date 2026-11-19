# Owner checklist

For the hub owner (`hub.owner` in `hub.config.json`): the one teammate who creates the repo and the board. Tokens and the unlock link travel by private message only; none of them goes in the repo.

## The short way: `./hub setup`

From the hub folder:

```bash
./hub setup
```

It asks for the event and the team, then writes `hub.config.json` and `team.json`, renders `docs/agent-prompt.md`, creates the private GitHub repo, invites your teammates, deploys the board to Vercel, and gives you the unlock link and prints the message to send the team. On a terminal it prints the link once (`--save-link` also keeps a copy in `.hub-owner.local`). When a coding agent runs it, or its output is not a terminal, or with `--yes`, the link never appears in the output: setup writes it to `.hub-owner.local` (gitignored, readable only by you) and the team message says to paste it from there. `--print-link` prints it anyway. With `gh` and `vercel` logged in as you, it does every step; without them it does what it can and prints the rest for you to do by hand. It also adds each teammate's onboarding task. `./hub setup --help` lists its options; `./hub setup --tokens` sets the board's one GitHub token, and `./hub setup --deploy` redeploys the board (pushing never does). Afterwards, `./hub doctor` should say `ok` on every line.

One thing setup cannot do for you: a token for a teammate whose agent runs in the cloud (step 5). Setup prints a section with a prefilled token link for that; you make one token per such person and send it privately.

Everything below is what setup does, step by step, for when you want to do it by hand or a step failed.

## By hand

### 1. Fill in the event and the team

- `hub.config.json`: `event.name`, `event.slug`, `event.timezone` (an IANA zone such as `America/New_York`), `event.startsAt` and `event.submitBy` (times with their offset, such as `2027-01-17T09:00:00-05:00`), `event.location`, `event.url`, `hub.repo` (`owner/name`), `hub.owner` (your id). Leave `hub.basePath` as `""` unless you mount the board under another site (`docs/deploy.md`).
- `team.json`: one entry per person with `id` (lowercase, used everywhere), `name`, `focus`, `github`, `githubId`, and `commitEmail`. `gh api users/<username> --jq .id` gives the id; the email is `<id>+<username>@users.noreply.github.com`. With these filled in, each person's commits credit their own account and the pre-push hook recognizes them.
- `docs/agent-prompt.md`: render it from `docs/agent-prompt.template.md`.

### 2. Create the private repo and invite the team

```bash
gh repo create <owner>/<name> --private --source . --push
gh api -X PUT repos/<owner>/<name>/collaborators/<username> -f permission=push
```

Run the second line once per teammate.

### 3. One onboarding task per teammate

Setup adds these for you. Each teammate's first task is "Connect your coding agent to the hub" (area `onboarding`, owner their id). Their agent checks it off at the end of the onboarding prompt (`./hub onboarded`), and the home page shows who is connected. By hand, once per person:

```bash
./hub add "Connect your coding agent to the hub" --why "Agents coordinate only through the hub; one paste, about five minutes" --owner <id> --area onboarding
```

### 4. Deploy the board

Follow `docs/deploy.md`, "Deploy on Vercel": link the project, set `HUB_KEY` and one token, deploy with `vercel deploy --prod`. The token is a fine-grained token limited to this repo with Contents read and write, saved as both `HUB_READ_TOKEN` and `HUB_WRITE_TOKEN`; give it an expiry a few days after the event. Pushing to the hub never deploys (`vercel.json` turns git deployments off).

### 5. Cloud agent teammates only

Skip this unless a teammate runs a cloud agent in the browser. Setup does not make this token; it prints a section with a prefilled link to the token page. For that person, create a fine-grained token limited to the hub repo (and the product repo once it exists), Contents read and write, expiring after the event, and send it privately. They save it as a personal secret named `HUB_GIT_TOKEN`. Revoke it after the event.

### 6. Send this to the team

Replace the placeholders and send it in the private team chat:

```text
Hub is ready. About five minutes:
1. Accept the GitHub invite to <owner>/<name> (github.com/notifications).
2. Open your coding agent and paste the prompt from docs/agent-prompt.md: https://github.com/<owner>/<name>/blob/main/docs/agent-prompt.md
3. Open the board once with this link, then tap your name: <UNLOCK_LINK>
Your agent asks who you are and tells you if it needs anything else.
```

## During the event

- Create the product repo when the event's rules allow it (many require a new public repo created during the event; check `kb/rules.md`), invite the team, and put its URL in `kb/project-repo.md`. Every agent's saved rule clones it from there.
- Redeploy the board (`./hub setup --deploy`) only when app code or `hub.config.json`'s `basePath` or `timezone` changes. Data never needs a deploy.
- A task that needs one teammate's accounts (their hosting, a paid API): write a prompt their agent can run start to finish, from the template in `docs/prompt-handoff.md`.
