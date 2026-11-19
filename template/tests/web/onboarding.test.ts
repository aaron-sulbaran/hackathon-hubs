import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PROMPT_FILE, extractPromptText, onboardingEntries } from "@/lib/web/onboarding";
import { snapshotFromFiles } from "@/lib/web/source";

describe("extractPromptText", () => {
  it("returns the body of the fenced text block, without the fence or the prose around it", () => {
    const markdown = "# Title\n\nPaste this.\n\n```text\nLine one\n   indented `code`\n\nLast line\n```\n\nAfter.\n";
    expect(extractPromptText(markdown)).toBe("Line one\n   indented `code`\n\nLast line");
  });

  it("skips fences in other languages and normalizes CRLF", () => {
    const markdown = "```sh\nls\n```\r\n\r\n```text\r\nA\r\nB\r\n```\r\n";
    expect(extractPromptText(markdown)).toBe("A\nB");
  });

  it("is null when there is no text block or no file", () => {
    expect(extractPromptText("# Nothing here\n\n```js\nx\n```\n")).toBeNull();
    expect(extractPromptText("```text\n\n```\n")).toBeNull();
    expect(extractPromptText(null)).toBeNull();
  });

  // A set-up hub renders docs/agent-prompt.md from docs/agent-prompt.template.md
  // (./hub setup); the demo hub carries a rendered one.
  it("finds the onboarding prompt in a hub's docs/agent-prompt.md", () => {
    const markdown = readFileSync(path.resolve(import.meta.dirname, "../fixtures/demo-hub", AGENT_PROMPT_FILE), "utf8");
    const prompt = extractPromptText(markdown);
    expect(prompt).not.toBeNull();
    expect(prompt?.startsWith("Set me up on my Sample Hackathon team's hub.")).toBe(true);
    expect(prompt).toContain("ids: ada, grace, linus");
    expect(prompt).toContain("./hub onboarded");
    expect(prompt).not.toContain("```");
    expect(markdown).toContain(prompt as string);
  });
});

describe("the snapshot carries the prompt file", () => {
  it("keeps docs/agent-prompt.md from the tarball files", () => {
    const snapshot = snapshotFromFiles(new Map([[AGENT_PROMPT_FILE, "```text\nhello\n```\n"], ["team.json", "{\"people\":[]}"]]));
    expect(extractPromptText(snapshot.agentPrompt)).toBe("hello");
    expect(snapshotFromFiles(new Map()).agentPrompt).toBeNull();
  });
});

describe("onboardingEntries", () => {
  const item = (id: string, owner: string | null, lane: "up_next" | "done", area: string | null = "onboarding") => ({ id, title: "Connect", owner, lane, area });

  it("finds each person's item by area and owner, never by id", () => {
    const items = [item("t-aaaa", "ada", "done"), item("t-bbbb", "grace", "up_next"), item("t-cccc", "grace", "up_next", "design"), item("t-dddd", null, "up_next")];
    expect(onboardingEntries(items, ["ada", "grace", "linus"])).toEqual([
      { owner: "ada", itemId: "t-aaaa", title: "Connect", done: true },
      { owner: "grace", itemId: "t-bbbb", title: "Connect", done: false },
    ]);
  });

  it("counts a person as done if any of their onboarding items is done", () => {
    const items = [item("t-aaaa", "grace", "up_next"), item("t-bbbb", "grace", "done")];
    expect(onboardingEntries(items, ["grace"])).toEqual([{ owner: "grace", itemId: "t-bbbb", title: "Connect", done: true }]);
  });
});
