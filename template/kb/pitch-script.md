---
title: Pitch script
summary: the pitch, cue by cue, for timed dry runs
kind: brief
updated:
by:
sources: []
group: ideas
---

# Pitch script

The pitch as timed parts, for dry runs on the board's Script page (Board, then "Pitch script"). The page reads the json block below; edit it here (a data commit, no deploy), or edit your own lines on the page. Set `totalTarget` from [[kb/judging]].

Each cue: `n` (its number), `who` (a team id, or `open` until someone takes it), `kind` (`say`, `quiet` when the screen leads, `both` to let it land and then speak), and optional `line`, `dir` (stage direction), `tap`, `wait`, `cut`, `draft`. Times are seconds or `"m:ss"`.

```json
{
  "totalTarget": "2:00",
  "beforeYouStart": "Check kb/judging.md for the format: how long a pitch may run, who watches, and whether you demo live. One laptop drives the demo.",
  "measured": "Nothing is timed yet. Read it aloud with the clock once the lines are real.",
  "footer": "Placeholder lines. Replace them as the pitch takes shape.",
  "parts": [
    {
      "id": "p1", "title": "The problem", "by": "not set", "target": "0:20",
      "cues": [{ "n": "1", "who": "open", "kind": "say", "draft": true, "line": "One sentence: who hurts, and why it matters." }]
    },
    {
      "id": "p2", "title": "The demo", "by": "not set", "target": "1:15",
      "cues": [{ "n": "1", "who": "open", "kind": "both", "draft": true, "dir": "One complete journey, live.", "line": "Say what the judge is seeing, not how it was built." }]
    },
    {
      "id": "p3", "title": "Why it matters", "by": "not set", "target": "0:25",
      "cues": [{ "n": "1", "who": "open", "kind": "say", "draft": true, "line": "Who this serves, and what is next." }]
    }
  ]
}
```
