// The built-in copy of the pitch script. The page shows it only when
// kb/pitch-script.md is missing or does not parse; edit the kb page, not this.
import type { PitchScriptInput } from "./pitch-script";

export const DEFAULT_PITCH_SCRIPT: PitchScriptInput = {
  totalTarget: "2:00",
  beforeYouStart: "Check kb/judging.md for the format: how long a pitch may run, who watches, and whether you demo live. One laptop drives the demo.",
  measured: "Nothing is timed yet. Read it aloud with the clock once the lines are real.",
  footer: "Placeholder. The real lines go in kb/pitch-script.md.",
  parts: [
    {
      id: "p1", title: "The problem", by: "not set", target: "0:20",
      cues: [{ n: "1", who: "open", kind: "say", draft: true, line: "One sentence: who hurts, and why it matters." }],
    },
    {
      id: "p2", title: "The demo", by: "not set", target: "1:15",
      cues: [{ n: "1", who: "open", kind: "both", draft: true, dir: "One complete journey, live.", line: "Say what the judge is seeing, not how it was built." }],
    },
    {
      id: "p3", title: "Why it matters", by: "not set", target: "0:25",
      cues: [{ n: "1", who: "open", kind: "say", draft: true, line: "Who this serves, and what is next." }],
    },
  ],
};
