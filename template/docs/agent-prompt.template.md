# Onboarding prompt for your coding agent

Paste everything in the box below as the first message to your coding agent. The same text works in Claude Code, Cursor, Codex, or any agent that can run shell commands. It takes about five minutes, asks you who you are, and ends with a four line report.

```text
Set me up on my {{EVENT_NAME}} team's hub. {{TEAM_SIZE}} (ids: {{TEAM_IDS}}) each run a coding agent, and the agents coordinate only through one private git repo, the hub: {{REPO_URL}}
{{DEADLINE_LINE}}

Do the steps in order. Run every command yourself. Ask me only where a step says to.

0. Check Node first: `node --version` must print v20.9.0 or newer (older versions crash the hub's command line tool). Older or missing: REMOTE, install the current LTS yourself (nvm install 22). LOCAL, tell me to run `brew install node` (or `nvm install 22 && nvm use 22`) and wait. Also check that `git --version` works.

1. Work out two things about yourself and tell me in one line.
   TOOL: your short name, for example claude-code, cursor, codex.
   WHERE: LOCAL if you run on my own computer and files stay between sessions. REMOTE if you run on a cloud machine rebuilt for each session (a cloud agent in the browser). If you cannot tell, ask me.

2. Ask me which teammate I am: {{TEAM_IDS_OR}}. Call the answer ID. This is the only question you need to ask.

3. Get the hub. If it is already cloned on this machine, use that folder and run `git pull --rebase` in it. Otherwise:
   mkdir -p {{CLONE_PARENT}} && GIT_TERMINAL_PROMPT=0 git clone {{REPO_URL}} {{CLONE_DIR}}
   Call the folder HUB and run the remaining steps from inside it. On Windows without a POSIX shell, `./hub` will not run: use `node scripts/hub.mjs <command>` wherever a step says `./hub <command>`.
   If the clone fails ("Repository not found", "could not read Username", "Authentication failed", or 403), GitHub does not know who I am yet. Tell me exactly this, wait, then try again:
   a. "Accept the repo invite at https://github.com/notifications. No invite? Send {{OWNER_NAME}} your GitHub username."
   b. LOCAL: "Run `gh auth login` in a terminal and pick GitHub.com, HTTPS, and login with a web browser."
      REMOTE: "Save a secret named HUB_GIT_TOKEN in this tool's secret settings, using the token {{OWNER_NAME}} sent you. Do not paste it in chat."
      REMOTE, once the secret exists: git config --global credential.helper store && printf 'https://x-access-token:%s@github.com\n' "$HUB_GIT_TOKEN" > ~/.git-credentials && chmod 600 ~/.git-credentials

4. Set who I am.
   LOCAL: `./hub me ID --agent TOOL`
   REMOTE: nothing on disk survives here, so `export HUB_ME=ID HUB_AGENT=TOOL` and keep both set on every hub command.

5. Run `./hub doctor`. Every line must start with `ok`. For a FIX line, do what its fix says, then run doctor again. If the fix needs me (the invite, a login, a token), tell me the exact words from step 3 and wait.

6. Read AGENTS.md in the hub. The short version: every session you sync, you pulse the files you are about to touch (that is what warns two people off the same file), and you post one line notes with a link. Pulse only from inside a clone of the project repo (`kb/project-repo.md` names it once it exists), as `<HUB>/hub pulse "<what and why>"`; run from the hub folder it refuses, and until the project repo exists there is nothing to pulse. Build, push, and merge without waiting for anyone. Lessons go in small knowledge pages; `./hub kb` lists every page with its summary, so read only the ones your task touches.

7. Make it stick. Read docs/standing-instruction.md and follow its "Where to save it" table for your TOOL, with <HUB> replaced by the full path of the hub folder (REMOTE: also the cloud part, with ID and TOOL filled in). Ask me before you write to a file outside the hub. If only I can save it, print the filled-in text in one code block and tell me where to paste it.

8. Prove the round trip and check off my first task: `./hub sync`, then `./hub onboarded "TOOL (WHERE)"`. The output must say `Pushed.` and `git status -sb` must not say `ahead`. If it says NOT pushed, I cannot write to the repo yet: go back to step 3a and 3b, then `./hub sync`.

Finish with exactly these four lines and nothing after them:
Hub: <HUB path> at <short commit>, ID on TOOL, WHERE
Round trip: <pushed | the error>
Standing instruction: <where it is saved | waiting for me to paste it>
Next: <the one thing I still need to do | nothing, I follow the loop in AGENTS.md>
```

What it needs from you: which teammate you are, and anything that needs a browser (accepting the invite, logging in to GitHub, saving a secret or a rule in your tool's settings). By hand instead: [setup.md](setup.md).
