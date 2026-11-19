# The playbook: running a hackathon with a hub

This is how to run a weekend with a hub, from the night before to the morning after. Follow it at your next event and change what does not fit your team.

Three kinds of people show up below:

- **The owner** sets up the hub and holds the accounts (GitHub, Vercel). One person.
- **Teammates** each run a coding agent: Claude Code, Cursor, Codex, anything that can run shell commands.
- **Agents** do most of the writing. They read the hub before they act and post to it after.

The examples use the sample team: Ada (`ada`, the owner), Grace (`grace`), and Linus (`linus`). The hub lives in a folder called `my-hub`. Unless a step says otherwise, `./hub` commands run in that folder.

A rule of thumb before you start: the hub is a tool, not a relay. Agents post one line and a link. Git holds the code, a pull request holds the review, a knowledge page holds what you learned. If you catch an agent pasting a whole plan into a note, it has the wrong idea.

## The night before (owner)

Do this at home, rested, with a working laptop. At one event we stood the hub up mid-event on no sleep, and it ate the first hour. At the next, copying an earlier hub, it took about ten minutes.

### 1. Create the hub

The scaffolder is not on npm yet. Today you run it from a clone of this repo:

```bash
node hackathon-hubs/packages/create-hackathon-hub/index.mjs my-hub
```

Once the package is published, `pnpm create hackathon-hub my-hub` (or `npm create hackathon-hub@latest my-hub`) will do the same thing. Until then those commands fail.

The scaffolder copies the hub into `my-hub`, starts a git repo there, and runs setup. To copy only and run setup later, add `--no-setup`, then `cd my-hub && ./hub setup`. On Windows, `./hub` does not run; use `node scripts/hub.mjs setup` and the same for every other command.

### 2. Let setup do the owner's checklist

Setup works best with two command line tools logged in: GitHub's `gh` (`gh auth login`) and Vercel's `vercel` (`npm i -g vercel && vercel login`). Without them it still runs, and for each part it cannot do it prints the steps to do by hand. Run `./hub setup` again any time. It picks up where it stopped and never redoes finished work. `./hub setup --dry-run` prints the plan and changes nothing.

It goes through nine steps:

1. Checks Node, git and your git identity, `gh`, and `vercel`.
2. Asks for the event: name, short name, time zone, when hacking starts, the submission deadline, and where. The event's web page is not asked for; pass `--event-url <url>` if you want it on the board. This writes `hub.config.json`.
3. Asks for each person: name, a short lowercase id (`grace`), focus, and GitHub username. With `gh` logged in it looks up each person's `githubId` and `commitEmail`, so every commit credits the right GitHub account. This writes `team.json`. Missing a username tonight? Leave it blank and run setup again when you have it.
4. Renders the onboarding prompt, `docs/agent-prompt.md`, for your event and team.
5. Adds one task per person, "Connect your coding agent to the hub". Their agent checks it off at the end of the prompt.
6. Commits, creates the private GitHub repo (named `<short name>-hub` unless you say otherwise), pushes, and invites your teammates.
7. Deploys the board to Vercel with a new unlock key, prints the unlock link once, then opens that link and the home page from outside to check the board really works. If the check fails, setup says where and exits with code 2.
8. Offers live mode (below).
9. Prints the message for your team.

The `id` is how everyone is named in the hub: in commands, in `@grace` mentions, in event file names. Everything specific to your event lives in `hub.config.json` and `team.json`, so fix a typo there, not in the code.

The unlock link is shown once. Lose it and `./hub setup --new-key` makes a new one, which everyone then has to open again. Add `--save-link` to keep a copy in a gitignored file.

Pushing to the hub never deploys the board. After changing the board's code, run `./hub setup --deploy`, which redeploys and checks the board again.

### 3. Turn on live mode

Right after setup, the board serves the files bundled into its last deploy. It shows what the repo held when you deployed, and saving from the board is off. Agents still write through `./hub` either way.

One GitHub token makes it live. Setup offers this as step 8, or run it later:

```bash
./hub setup --tokens
```

It prints a GitHub link with the token's name, expiry (a few days after your submission deadline), and permission (Contents: Read and write) already filled in. On that page you pick one thing, the hub repo, then generate the token and paste it back. Setup saves it on the deployment and redeploys. From then on the board reads the repo within about 30 seconds and teammates can answer questions and add tasks from their phones.

If you would rather the reads use a read-only token, `./hub setup --tokens --separate-tokens` makes two: one to read, one to write.

Tokens and the unlock link travel by private message only, never in the repo, a note, or a page. If your hub's `main` branch is protected so that changes need a pull request, the board cannot write. Leave the hub's `main` open to its collaborators.

### 4. Send the one message

Setup prints it, with your repo filled in:

```text
Hub is ready. About five minutes:
1. Accept the GitHub invite to <owner>/my-hub (github.com/notifications).
2. Open your coding agent and paste the prompt from docs/agent-prompt.md: https://github.com/<owner>/my-hub/blob/main/docs/agent-prompt.md
3. Open the board once with this link, then tap your name: <UNLOCK_LINK>
Your agent asks who you are and tells you if it needs anything else.
```

Put the unlock link in where it says `<UNLOCK_LINK>` only if your team chat is private. Otherwise send the link to each person by private message. That is the whole onboarding.

### 5. Put the official documents in `sources/`

Everything the organizers give you goes in `sources/`, as is: the hacker guide, the schedule, the rules, the track and prize list, the judging rubric, the opening slides. Convert a PDF to text if you can, and keep the original beside it. Files in `sources/` are never edited. When something new arrives (and the schedule always changes), add a new file with the date in its name.

At one event the onsite packet, venue map, and prize tracks all arrived late through the event chat. Because the hub had a place for them, an agent turned them into pages within minutes of arrival.

### 6. Write the first knowledge pages

The hub comes with starter pages in `kb/`, mostly empty headings. Ask your agent to fill these four from `sources/` before you sleep:

- `kb/rules.md`: what you may and may not do. Repo rules ("a new public repo, created during the event"), team size, what counts as prior work, what the submission must include.
- `kb/tracks.md`: every track and prize, one short block each, with what it asks for.
- `kb/judging.md`: the rubric with its weights, word for word. Judges score from it, so your pitch should too.
- `kb/playbook.md`: the schedule. The board turns it into the Schedule page and the countdown. Two sections, one line per entry:

```markdown
## Deadlines

- 2027-01-17T09:00-05:00 | Submissions due | kind: deadline

## Calendar

- 2027-01-16T18:00-05:00 | Dinner | kind: meal | where: Room 120
- 2027-01-16T20:00-05:00 | Mentor office hours | kind: event | until: 2027-01-16T22:00-05:00
```

Every page has a short frontmatter block (title, summary, kind, updated, by, sources), stays under about 400 words, and covers one topic. Use short lists, not wide tables; people will read these on a phone. The `summary:` line says what the page answers. `./hub kb` lists every page by its summary, so an agent can find the right one without opening every file, and nobody has to keep an index up to date. The agent commits each page with:

```bash
./hub learn kb/judging.md "Judging rubric from the hacker guide"
```

Then do a dry run: one teammate pastes the prompt, opens the board on a phone, and asks you a question through it. Fixing a broken invite at home takes a minute. At the venue it takes a lot longer.

## The first hour

### Everyone connects their agent

Each teammate accepts the invite, pastes the prompt from `docs/agent-prompt.md` into their agent, and opens the unlock link once on each device. The prompt asks one question ("which teammate are you?"), sets the agent up, runs `./hub doctor` until every line says `ok`, and checks off that person's first task. The board's home page shows who is connected.

Setup gave each teammate one task, "Connect your coding agent to the hub". When their agent finishes the prompt it runs `./hub onboarded`, which checks the task off and proves the agent can write to the hub.

Teams formed at the event are where this matters most. When you met half your team that morning, one paste is the difference between their agents joining in minutes and joining never.

### Research and brainstorm before any agent builds

The first instinct is to start coding. Don't, for about an hour. Two rules our teams kept coming back to: decide before building, and always have a version you could submit.

Run research as capped tracks. Each track is one agent with one question and hard limits written in its brief:

- a time cap (we used 25 minutes), after which it writes what it has
- a search cap (about 10 searches or fetches)
- one notes file, at most about 1,200 words: findings with sources, one recommendation, open risks
- research only: no installs, no code, no API keys printed

Good first tracks: the sponsor API or model you would build on (does a key actually work? what does it cost?), the judging rubric and past winners, and one track per serious idea. Set a stop time for the whole sprint and put it in `kb/playbook.md`. Research with no end is the other way to end up cramming at 4 AM.

For ideas, give agents different lenses rather than one open prompt. Two agents with two different lenses produced dozens of ideas in one pass. Agents can rank. People choose.

### Ideas become pages

Each serious idea gets its own page, `kb/idea-<slug>.md`: the one-sentence pitch, the demo in three steps, which tracks it fits, the riskiest unknown. The starter page `kb/ideas.md` is the shortlist that links them. Now everyone, people and agents, argues about the same text instead of four memories of a conversation.

### The team decides

Talk it through in person. Then one agent records the call, so every agent hears it at its next sync:

```bash
./hub propose "Build the check-in idea, one journey in three steps" --why "Fits two tracks and demos in under two minutes" --affects kb/idea-checkin
```

A proposal is a record, not a request. Nobody waits for a sign-off. Anyone who disagrees says so on the board or changes the code.

### Split the work into lanes

A lane is a person plus the folders they own: Ada on the UI, Grace on the API and data, Linus on hardware and deploys. Write the lane table at the top of the product repo's `AGENTS.md` so every agent sees it. Shared files that every lane imports (the data types, the root layout, `package.json`, environment variable names) belong to nobody; touching them takes a pulse first.

Then make the first tasks, one per lane:

```bash
./hub add "Check-in screen with the three steps" --why "The demo starts here" --owner ada --area ui
./hub add "Check-in API and seed data" --why "The screen needs real data by 10 PM" --owner grace --area api
```

Create the product repo now if the rules want it created during the event. Put its URL in `kb/project-repo.md`. Each teammate clones it beside the hub, so `my-hub/` and `product/` sit in the same folder. Then, from the hub folder, install the hooks and check the clone:

```bash
node scripts/install-hooks.mjs ../product
./hub doctor --repo ../product
```

The hooks pulse in the background after each commit and checkout, and refuse a push authored as a bot or as another teammate. `doctor` sets the clone's commit identity to that person's GitHub account if it was wrong.

## While building

### The loop every agent follows

This is in the hub's `AGENTS.md`, and agents run it without being asked. You should know it too, so you can tell when an agent skips it.

1. **Sync** at the start of every session and about every 15 minutes: `./hub sync`, then `./hub status`. Sync says in plain words what changed since last time and what is waiting for you.
2. **Claim** before working: `./hub claim t-a3f9 --why "Taking the API"`, or `./hub add "<title>" --why "<why>" --claim` for something new. The first claim wins: if two agents grab the same task at once, the second one is told to pick something else, and its claim does not change the owner. `--take` takes a task over once its owner agrees.
3. **Pulse** from the product clone before editing. The tool lives in the hub folder, so call it by its path: `../my-hub/hub pulse "Check-in API: route and schema"`. It posts your branch and the files you are changing, and prints any overlap with a teammate. Read `../my-hub/hub who` before touching a shared file.
4. **Push early.** A branch that exists only on a laptop is invisible to everyone.
5. **Merge your own pull request** when checks are green. No sign-off. If two changes collide, whoever merges second fixes it on `main`. Then pulse again so the others know to pull.
6. **Note** what changed in one line with a link: `./hub note "Check-in API merged" --ref t-a3f9`.
7. **Finish**: `./hub done t-a3f9 --link <pull request URL>`.

What the overlap warning looks like, printed by Linus's pulse:

```text
grace is editing app/api/checkin/route.ts on grace/api-checkin (pushed, 6m ago). Pull before you push.
Rebase now: main changed 1 of your files (package.json).
```

That warning is most of the point. Two agents rewriting the same file for an hour is the most expensive mistake at a hackathon, and this catches it in the first minute.

At one event, pulses and one-line notes made up most of what agents wrote. Sessions, gates, and sign-offs went almost unused, and some agents barely wrote to the hub at all. Keep the protocol to what a cold agent will actually do.

### What needs a person

Agents decide almost everything themselves. A few things only a person can do:

- **Anything on someone's own account:** a paid service, a sponsor API key, a GitHub invite, a deploy setting.
- **Anything involving a secret.** Keys live in `.env.local` and the deployment's settings, never in code, events, or pages.
- **Answering a real question.** An agent that is stuck asks instead of guessing, then works on something else:

```bash
./hub ask "Which account should own the sponsor API key?" --for ada --blocking t-k2p7
./hub block t-k2p7 "Needs the sponsor API key in .env.local" --needs ada
```

These show up under **Needs you** on the home page, by person. Answer from the board or the terminal (`./hub answer q-m4xz "Mine. Key is in the team password vault."`); the asker settles it with `./hub settle`.

- **Accepting or rejecting a call on record**, if you want to. `./hub accept d-7hq2 --human` is optional and only a person may write it. Most teams never need it.

At one event we required sign-off on every decision. Ten calls queued in two hours and the agents sat idle. We dropped sign-off that night and never brought it back.

### Checkpoints: always have something you could submit

A version is a build that is tagged in the repo, runs at a public link, and is saved on the submission site. At any moment the latest version is what you would submit. Plan three, with times, in `kb/playbook.md`:

- **Version 1, early evening:** one journey end to end, each part in its simplest form, really joined together. Save the submission draft the same hour.
- **Version 2, after midnight:** the journey done properly: real data, error states, the look.
- **Version 3, small hours:** one stretch goal, picked at version 2 from what is working.

A new version replaces the old one only when it is better and it runs. Every stretch goal gets an abort time; if it is not running by then, the last version stands and the idea becomes a "what's next" slide. Tag each version (`git tag v1 && git push origin v1`) so there is always a known-good build to go back to.

At one event the core passed its checkpoint three hours early. Because it was tagged, we started the stretch goals with nothing to lose.

Do the soft submission (or create the empty project) as soon as the submission site opens. It takes five minutes, everyone must join the site before they can be added as a teammate, and some events tie perks to it.

### Overnight

- Heavy agent work happens before midnight. After that, people review, test, rehearse, and write.
- Sleep in turns of about 90 minutes. Never everyone at once, never nobody.
- Before you sleep, leave one page of asks for the morning, each with "done looks like". At one event that page turned a tired 2 AM into a pitch that was ready by breakfast.
- When an agent's usage runs low, it merges or pushes everything, then posts one note: what is done, what is half done, which branch. Another agent picks it up from there.
- For design feedback, an agent posts a screenshot with `./hub design shot.png "Check-in screen, first pass" -m "Too busy?"`. It shows on the board's Design page; answers are the feedback.

## The last three hours

Set a feature freeze about three hours before submissions close and put it in `kb/playbook.md`. After the freeze: fixes only, one person deploys, and production stays on the build you rehearsed.

Keep two clocks apart: when submissions are due, and when you present. They are often hours apart. At one event we nearly missed the submission deadline because everyone was watching the presentation time.

### The submission checklist

Fill in the starter page `kb/submission.md` the night before, from `kb/rules.md`, and tick it off in the last hours. A typical list:

- [ ] Every teammate has joined the submission site and accepted the team invite
- [ ] Project name and a one-line tagline
- [ ] The demo video link, unlisted, opened in a logged-out window
- [ ] The public repo link; the repo was created during the event if the rules say so
- [ ] A README that says what you built and what you used
- [ ] The written description, including the role of AI if a track asks for it
- [ ] Tracks and prizes picked, within the cap
- [ ] A second form, if a sponsor track has its own
- [ ] Screenshots
- [ ] Every link opened in a logged-out window

Then read the description and README out loud, looking only for claims you cannot back up. Numbers you measured once, features that only run on seed data, words like "really" and "instantly". At one event that read-through caught ten. Say what is seeded before a judge asks.

### The demo video

Record a backup before the freeze, from a clean run on the live deployment. Plan it beat by beat with times (problem, demo, how it works, what's next), and keep it under the limit with ten seconds to spare. Show the AI doing visible work in the first 30 seconds. Record several takes, add captions, upload it unlisted, and test the link logged out.

### The pitch script and the shared clock

The pitch script lives in `kb/pitch-script.md` and opens on the board as a run sheet: every line, who says it, and the stage direction. Anyone can fix a line from their phone during rehearsal.

The clock on that page is shared. When one person presses start, every phone shows the same running time, split by part. Rehearse with it at least twice, on real devices and the venue Wi-Fi. At one event a timed rehearsal found the pitch running at 4:50 of a 5:00 slot, which is too close. At another, phones, the mic, and the venue Wi-Fi were untested until a morning check.

### Who presents

Decide it on the board, not in a hallway at 9 AM. One person talks, one person drives the demo, and someone holds a backup: the video open in a tab, the demo reset to its starting state. Get to the demo fast; skip the long introduction. Read the rubric again and make sure the pitch says something about every weighted criterion. If a judge can try it on their own phone, offer that. At one event, that was the best moment of judging.

## After

### What shipped

Before everyone scatters, have an agent write `kb/what-shipped.md`: what works, what was cut, the repo, the video, the submission link, and the result once you know it. Close the open items with `./hub done` and links, so the board tells the true story.

### Lessons into pages

Lessons go in `kb/lessons.md`, one line each with evidence (a commit, a page, an event count), grouped by coordination, demo and pitch, scoping, and overnight. Commit it with `./hub learn kb/lessons.md "Lessons from the weekend"`. Bring it to your next hub. Half of this playbook started as lines on pages like that.

### Take the hub down

The hub holds working credentials until you remove them. Do this the day after:

1. **Delete the board's GitHub token** (GitHub, Settings, Developer settings, Fine-grained tokens). It is one token, unless you chose `--separate-tokens`; then delete both. Delete any token you made for a teammate's cloud agent too, and ask them to delete the `HUB_GIT_TOKEN` secret they saved.
2. **Remove the token from the deployment.** One token is stored under two names, so remove both: `vercel env rm HUB_READ_TOKEN production` and `vercel env rm HUB_WRITE_TOKEN production`. Then `vercel deploy --prod`. The board goes back to serving its bundled files, read-only.
3. **Rotate or remove the unlock key.** `./hub setup --new-key` makes a new key and redeploys, which signs everyone out. To close the board completely, `vercel env rm HUB_KEY production`, then `vercel deploy --prod`: a production deploy with no key answers every request with a 404. (Use `vercel deploy` here, not `./hub setup --deploy`, which would make a new key.) Sessions also run out on their own 14 days after someone opened the link. If you used `--save-link`, delete `.hub-owner.local`.
4. **Remove the hooks** from each product clone, from the hub folder: `node scripts/install-hooks.mjs ../product --uninstall`.
5. **Archive the hub repo** on GitHub, or remove collaborators. The history is worth keeping. It is the most honest record of the weekend you will have.
