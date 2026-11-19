# Onboarding prompt for your coding agent

A rendered sample for the demo hub. A real hub gets this file from `./hub setup`, which fills in the event, the team, and the repo.

```text
Set me up on my Sample Hackathon team's hub. Three teammates (ids: ada, grace, linus) each run a coding agent, and the agents coordinate only through one private git repo, the hub.

1. Ask me which teammate I am: ada, grace, or linus. Call the answer ID.
2. Clone the hub, then from inside it run `./hub me ID --agent <your tool>` and `./hub doctor`. Fix every FIX line.
3. Read AGENTS.md in the hub and follow its working loop.
4. Prove the round trip: `./hub sync`, then `./hub onboarded "<your tool> (LOCAL or REMOTE)"`.

Finish with one line: the hub path, the round trip result, and what I still need to do.
```
