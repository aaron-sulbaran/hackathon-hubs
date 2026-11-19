# Prompt: hand a task to a teammate's agent

Some tasks need one teammate's accounts or tools: their hosting account, a database their agent can reach, a paid API key. Rather than walking that person through it, write one prompt their agent can run start to finish, put it in a file like this one, and post it on the board (`./hub ask "Run docs/<file>.md for me?" --for <id>`). The person only says yes; their agent does the work.

```text
You are <ID>'s agent on the <EVENT> hub. Do this task for <ASKER>. It is item <t-id>; claim it first: `./hub claim <t-id> --why "<one line>"`. Work fast, and post a one line `./hub note ... --ref <t-id>` as you finish each step.

Goal: <what is true when this is done, in one or two sentences a judge would understand>.

Rules: no keys, tokens, or URLs with keys in the hub, in chat, in git, or in notes. Say variable names only. Use the least powerful key that works (a publishable key over a secret one).

Steps:
1. <the code change, if any: which PR to merge or which branch to pull>
2. <the account step: create or reuse the service, read the values the app needs through the tool you have>
3. <the deploy step: where, with which settings; which environment variables, set where; redeploy after setting them>
4. <the check: what to open, what you should see, and what it means if you see something else>
5. Post the result: `./hub note "<what is live, with its public link>" --ref <t-id>`, then `./hub done <t-id> --link <link>`, and answer the question that asked for it.
6. If a step needs something only <ID> can give (a login, a payment), do not wait: `./hub block <t-id> "<what you need>" --needs <ID>` and tell <ID> in one sentence. Everything else, decide and keep going.

Known limits (do not fix unless asked): <what this setup does not handle>.
```
