import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultConfig, parseConfig } from "../../lib/hub/config.mjs";
import { deadlineLine, fillTemplate, listWithOr, renderAgentPrompt, teamSizePhrase } from "../../lib/hub/agent-prompt.mjs";

const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function shipped() {
  const config = parseConfig(JSON.parse(readFileSync(join(templateRoot, "hub.config.json"), "utf8"))).data;
  const team = JSON.parse(readFileSync(join(templateRoot, "team.json"), "utf8"));
  return { config, team };
}

function eventConfig(event = {}, hub = {}) {
  const base = defaultConfig();
  return { ...base, event: { ...base.event, ...event }, hub: { ...base.hub, owner: "ada", ...hub } };
}

const sampleTeam = {
  people: [
    { id: "ada", name: "Ada Example" },
    { id: "grace", name: "Grace Example" },
    { id: "linus", name: "Linus Example" },
  ],
};

test("the committed docs/agent-prompt.md is the render of the shipped config and team", () => {
  const { config, team } = shipped();
  const rendered = renderAgentPrompt(config, team);
  assert.equal(rendered.error, null);
  assert.equal(readFileSync(join(templateRoot, "docs", "agent-prompt.md"), "utf8"), rendered.data);
});

test("a render leaves no template fields behind", () => {
  const { data, error } = renderAgentPrompt(eventConfig(), sampleTeam);
  assert.equal(error, null);
  assert.ok(!data.includes("{{"), "found a leftover {{");
  assert.ok(!data.includes("}}"), "found a leftover }}");
});

test("the render names the event, ids, repo, clone folder, deadline, and owner", () => {
  const config = eventConfig(
    { name: "Winter Build", slug: "winter-build", timezone: "America/New_York", submitBy: "2027-01-17T09:00:00-05:00" },
    { repo: "someone/winter-build-hub", owner: "grace" },
  );
  const { data } = renderAgentPrompt(config, sampleTeam);
  assert.match(data, /Set me up on my Winter Build team's hub\. Three teammates \(ids: ada, grace, linus\)/);
  assert.match(data, /Ask me which teammate I am: ada, grace, or linus\./);
  assert.match(data, /git clone https:\/\/github\.com\/someone\/winter-build-hub\.git ~\/winter-build\/hub/);
  assert.match(data, /mkdir -p ~\/winter-build &&/);
  assert.match(data, /Submissions are due Sun, Jan 17, 9:00 AM EST, so keep this quick\./);
  assert.match(data, /Send Grace your GitHub username/);
  assert.match(data, /the token Grace sent you/);
});

test("the four line report survives rendering", () => {
  const { data } = renderAgentPrompt(eventConfig(), sampleTeam);
  const report = data.split("Finish with exactly these four lines and nothing after them:\n")[1].split("\n").slice(0, 4);
  assert.deepEqual(report.map((line) => line.split(":")[0]), ["Hub", "Round trip", "Standing instruction", "Next"]);
});

test("without a repo the URL is a readable placeholder", () => {
  const { data } = renderAgentPrompt(eventConfig({ slug: "sample-hackathon" }), sampleTeam);
  assert.match(data, /https:\/\/github\.com\/<owner>\/sample-hackathon-hub\.git/);
});

test("the deadline is shown in the event's zone", () => {
  assert.equal(
    deadlineLine(eventConfig({ timezone: "America/Los_Angeles", submitBy: "2027-07-18T12:00:00-04:00" })),
    "Submissions are due Sun, Jul 18, 9:00 AM PDT, so keep this quick.",
  );
  assert.equal(deadlineLine(eventConfig({ submitBy: "" })), "The clock is running, so keep this quick.");
});

test("small helpers read naturally", () => {
  assert.equal(listWithOr(["ada"]), "ada");
  assert.equal(listWithOr(["ada", "grace"]), "ada or grace");
  assert.equal(listWithOr(["ada", "grace", "linus"]), "ada, grace, or linus");
  assert.equal(teamSizePhrase(1), "One teammate");
  assert.equal(teamSizePhrase(4), "Four teammates");
  assert.equal(teamSizePhrase(12), "12 teammates");
});

test("an unknown field or a stray brace is an error, not a silent gap", () => {
  assert.match(fillTemplate("{{NOPE}}", {}).error, /NOPE/);
  assert.match(fillTemplate("{{ x", {}).error, /\{\{/);
  assert.equal(renderAgentPrompt(eventConfig(), { people: [] }).error, "team.json has nobody in it.");
});
