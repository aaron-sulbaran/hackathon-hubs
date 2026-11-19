import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPeople,
  buildPlan,
  collectAliases,
  commitEmailFor,
  envNamesFrom,
  isSampleEvent,
  mergePeople,
  parseDeployOutput,
  parseJsonOutput,
  parseVercelWhoami,
  vercelFailure,
  generateHubKey,
  parseLocalTime,
  parsePersonSpec,
  personIdFor,
  pickBoardUrl,
  repoFromRemote,
  shouldPrintLink,
  slugify,
  teamMessageLines,
  tokenExpiryDays,
  tokenPageUrl,
  unlockLink,
  withIgnoreLines,
} from "../../scripts/setup/pure.mjs";
import { verifyBoard } from "../../scripts/setup/verify.mjs";
import { writeIfChanged } from "../../scripts/setup/io.mjs";

const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------- pure parts ----------

test("slugs come from the event name", () => {
  assert.equal(slugify("Sample Hackathon"), "sample-hackathon");
  assert.equal(slugify("  Hack Día 2027!! "), "hack-dia-2027");
  assert.equal(slugify("***"), "hackathon");
  assert.ok(slugify("a".repeat(80)).length <= 40);
});

test("person ids come from first names and stay unique", () => {
  assert.equal(personIdFor("Ada Example"), "ada");
  assert.equal(personIdFor("Ada Example", ["ada"]), "adae");
  assert.equal(personIdFor("Ada", ["ada"]), "ada2");
  assert.equal(personIdFor("Zoë Q", []), "zoe");
  assert.equal(personIdFor("42", []), "person");
});

test("wall-clock times get the zone's offset for that date", () => {
  assert.deepEqual(parseLocalTime("2027-01-17 09:00", "America/New_York"), { data: "2027-01-17T09:00:00-05:00", error: null });
  assert.equal(parseLocalTime("2027-07-17 09:00", "America/New_York").data, "2027-07-17T09:00:00-04:00");
  assert.equal(parseLocalTime("2027-01-17 9:30 pm", "Europe/Berlin").data, "2027-01-17T21:30:00+01:00");
  assert.equal(parseLocalTime("2027-01-17T12:00 am", "Asia/Kolkata").data, "2027-01-17T00:00:00+05:30");
  assert.equal(parseLocalTime("2027-01-17 09:00", "UTC").data, "2027-01-17T09:00:00+00:00");
  assert.equal(parseLocalTime("2027-03-14 03:30", "America/New_York").data, "2027-03-14T03:30:00-04:00");
  assert.equal(parseLocalTime("2027-01-17T09:00:00-08:00", "America/New_York").data, "2027-01-17T09:00:00-08:00");
  assert.deepEqual(parseLocalTime("", "UTC"), { data: "", error: null });
  assert.match(parseLocalTime("2027-02-30 09:00", "UTC").error, /not a real date/);
  assert.match(parseLocalTime("tomorrow", "UTC").error, /not a time/);
  assert.match(parseLocalTime("2027-01-17 25:00", "UTC").error, /time of day/);
});

test("commit emails are GitHub no-reply addresses", () => {
  // Ids from 9,000,000,001 up are far past any real GitHub account, here and in the fake gh below.
  assert.equal(commitEmailFor(9000000001, "ada-gh"), "9000000001+ada-gh@users.noreply.github.com");
});

test("--person reads key=value pairs or a bare name", () => {
  assert.deepEqual(parsePersonSpec("name=Ada Example;github=ada-gh;focus=Frontend, design;id=ada").data, {
    name: "Ada Example",
    github: "ada-gh",
    focus: "Frontend, design",
    id: "ada",
  });
  assert.deepEqual(parsePersonSpec("Grace Example").data, { name: "Grace Example" });
  assert.match(parsePersonSpec("github=x").error, /needs name/);
  assert.match(parsePersonSpec("name=A;email=a@b").error, /unknown key/);
});

test("building people fills ids and keeps GitHub facts for the same account", () => {
  const previous = [{ id: "ada", name: "Ada", focus: "UI", github: "ada-gh", githubId: 9000000001, commitEmail: "9000000001+ada-gh@users.noreply.github.com", emails: [] }];
  const { data } = buildPeople([{ name: "Ada Example", github: "@ada-gh" }, { name: "Ada Other" }], previous);
  assert.equal(data[0].id, "ada");
  assert.equal(data[0].githubId, 9000000001);
  assert.equal(data[0].focus, "UI");
  assert.equal(data[1].id, "adao");
  assert.equal(data[1].githubId, null);
  const changed = buildPeople([{ name: "Ada", github: "someone-else" }], previous).data[0];
  assert.equal(changed.githubId, null);
  assert.equal(changed.commitEmail, "");
  assert.match(buildPeople([{ name: "A", id: "Bad Id" }]).error, /not a usable id/);
  assert.match(buildPeople([]).error, /at least one/);
  assert.match(buildPeople([{ name: "A", github: "-bad" }]).error, /not a GitHub username/);
});

test("small helpers", () => {
  assert.match(generateHubKey(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(generateHubKey(), generateHubKey());
  assert.equal(unlockLink("https://x.vercel.app/", "", "k-1"), "https://x.vercel.app/unlock?key=k-1");
  assert.equal(unlockLink("https://x.vercel.app", "/hub", "k"), "https://x.vercel.app/hub/unlock?key=k");
  assert.equal(repoFromRemote("https://github.com/someone/sample-hackathon-hub.git"), "someone/sample-hackathon-hub");
  assert.equal(repoFromRemote("git@github.com:someone/x-hub.git"), "someone/x-hub");
  assert.equal(repoFromRemote("/tmp/bare.git"), "");
  assert.equal(pickBoardUrl(["proj-abc123-team.vercel.app", "proj.vercel.app"], "https://proj-abc123-team.vercel.app"), "https://proj.vercel.app");
  assert.equal(pickBoardUrl(["proj.vercel.app", "board.example.org"], ""), "https://board.example.org");
  assert.equal(pickBoardUrl([], "https://proj-abc.vercel.app/"), "https://proj-abc.vercel.app");
  assert.deepEqual(collectAliases({ a: { aliases: ["x.vercel.app", { alias: "y.vercel.app" }] }, alias: "z.app" }), ["x.vercel.app", "y.vercel.app", "z.app"]);
  assert.deepEqual(envNamesFrom({ envs: [{ key: "HUB_KEY" }, { key: "HUB_REPO", value: "a/b" }] }).sort(), ["HUB_KEY", "HUB_REPO"]);
  const url = new URL(tokenPageUrl({ name: "x read", description: "d", owner: "someone", contents: "read", expiresInDays: 5 }));
  assert.equal(url.pathname, "/settings/personal-access-tokens/new");
  assert.equal(url.searchParams.get("contents"), "read");
  assert.equal(url.searchParams.get("target_name"), "someone");
  assert.equal(url.searchParams.get("expires_in"), "5");
  assert.equal(tokenExpiryDays("2027-01-17T09:00:00-05:00", Date.parse("2027-01-10T09:00:00-05:00")), 10);
  assert.equal(tokenExpiryDays(""), 7);
});

test("the unlock link is printed only on a terminal without --yes, or with --print-link", () => {
  assert.equal(shouldPrintLink({ stdoutIsTTY: true, yes: false, printLink: false }), true);
  assert.equal(shouldPrintLink({ stdoutIsTTY: true, yes: true, printLink: false }), false);
  assert.equal(shouldPrintLink({ stdoutIsTTY: false, yes: false, printLink: false }), false);
  assert.equal(shouldPrintLink({ stdoutIsTTY: undefined, yes: undefined, printLink: undefined }), false);
  assert.equal(shouldPrintLink({ stdoutIsTTY: false, yes: true, printLink: true }), true);
  assert.match(buildPlan(planFacts({ printLink: true })).find((step) => step.key === "board").detail, /print the unlock link/);
  assert.match(buildPlan(planFacts()).find((step) => step.key === "board").detail, /save the unlock link in \.hub-owner\.local/);
});

test("ignore lines are added once", () => {
  const first = withIgnoreLines("node_modules/\n", [".hub-owner.local", ".vercel"]);
  assert.deepEqual(first.added, [".hub-owner.local", ".vercel"]);
  const second = withIgnoreLines(first.text, [".hub-owner.local", ".vercel"]);
  assert.deepEqual(second.added, []);
  assert.equal(second.text, first.text);
  assert.deepEqual(withIgnoreLines("/.vercel\n", [".vercel"]).added, []);
});

function planFacts(overrides = {}) {
  return {
    nodeVersion: "22.0.0",
    nodeOk: true,
    gitOk: true,
    gitName: "Ada Example",
    gitEmail: "9000000001+ada-gh@users.noreply.github.com",
    gh: { installed: true, loggedIn: true, login: "ada-gh" },
    vercel: { installed: true, loggedIn: true },
    eventConfirmed: false,
    eventChanges: false,
    eventName: "Sample Hackathon",
    teamConfirmed: false,
    teamChanges: false,
    teamIds: ["ada", "grace"],
    githubLookups: [],
    promptCurrent: false,
    hubCliPresent: true,
    onboardingMissing: ["ada", "grace"],
    gitRepo: false,
    uncommitted: true,
    originExists: false,
    unpushed: false,
    plannedRepo: "ada-gh/sample-hackathon-hub",
    repo: "",
    skipGithub: false,
    invitesToSend: ["grace-gh"],
    skipVercel: false,
    vercelLinked: false,
    hubKeySet: false,
    hubRepoSet: false,
    newKey: false,
    deployed: false,
    boardUrl: "",
    tokensSet: false,
    wantTokens: false,
    ...overrides,
  };
}

test("a fresh hub plans every step", () => {
  const plan = buildPlan(planFacts());
  assert.deepEqual(plan.map((step) => step.key), ["preflight", "event", "team", "prompt", "seed", "github", "board", "tokens", "message"]);
  const status = Object.fromEntries(plan.map((step) => [step.key, step.status]));
  assert.deepEqual(status, { preflight: "done", event: "todo", team: "todo", prompt: "todo", seed: "todo", github: "todo", board: "todo", tokens: "skip", message: "todo" });
  assert.match(plan.find((step) => step.key === "github").detail, /create private repo ada-gh\/sample-hackathon-hub/);
});

test("the team message mentions the GitHub invite only when one is outstanding", () => {
  const base = { repo: "ada-gh/x-hub", branch: "main" };
  const withInvite = teamMessageLines({ ...base, inviteOutstanding: true });
  assert.match(withInvite[1], /^1\. Accept the GitHub invite to ada-gh\/x-hub/);
  assert.match(withInvite[2], /^2\. Open your coding agent/);
  assert.match(withInvite[3], /^3\. Open the board/);
  const without = teamMessageLines({ ...base, inviteOutstanding: false });
  assert.ok(!without.join("\n").includes("invite"), "no invite step");
  assert.match(without[1], /^1\. Open your coding agent/);
  assert.match(without[2], /^2\. Open the board/);
});

test("a finished hub plans nothing but the message", () => {
  const plan = buildPlan(planFacts({
    eventConfirmed: true, teamConfirmed: true, promptCurrent: true, onboardingMissing: [], gitRepo: true, uncommitted: false,
    originExists: true, repo: "ada-gh/sample-hackathon-hub", invitesToSend: [], vercelLinked: true, hubKeySet: true, hubRepoSet: true,
    deployed: true, boardUrl: "https://sample-hackathon-hub.vercel.app", tokensSet: true,
  }));
  assert.deepEqual(plan.filter((step) => step.status !== "done").map((step) => step.key), ["message"]);
});

test("missing tools turn their steps into manual ones", () => {
  const plan = buildPlan(planFacts({ gh: { installed: false, loggedIn: false, login: "" }, vercel: { installed: true, loggedIn: false }, hubCliPresent: false, wantTokens: true, repo: "ada-gh/x-hub", gitEmail: "" }));
  const status = Object.fromEntries(plan.map((step) => [step.key, step.status]));
  assert.equal(status.github, "manual");
  assert.equal(status.board, "manual");
  assert.equal(status.tokens, "manual");
  assert.equal(status.seed, "skip");
  assert.equal(status.preflight, "manual");
  assert.match(plan[0].detail, /user\.name or user\.email is not set/);
});

test("CLI output parsers read the shapes the real tools print", () => {
  // `vercel deploy --json`, and the same object wrapped when a coding agent runs the CLI.
  const plain = { id: "dpl_1", url: "https://x-abc-team.vercel.app", productionUrl: "https://x.vercel.app", readyState: "READY" };
  assert.deepEqual(parseDeployOutput(JSON.stringify(plain, null, 2)), { url: "https://x-abc-team.vercel.app", productionUrl: "https://x.vercel.app" });
  const agent = { status: "ok", deployment: { ...plain, deploymentApiUrl: "https://api.vercel.com/v13/deployments/dpl_1" }, message: "Deployment ready. Production URL: https://x.vercel.app", next: [] };
  assert.deepEqual(parseDeployOutput(JSON.stringify(agent)), { url: "https://x-abc-team.vercel.app", productionUrl: "https://x.vercel.app" });
  assert.deepEqual(parseDeployOutput(JSON.stringify({ ...plain, productionUrl: null })), { url: "https://x-abc-team.vercel.app", productionUrl: "" });
  assert.deepEqual(parseDeployOutput("not json"), { url: "", productionUrl: "" });

  assert.deepEqual(parseVercelWhoami({ ok: true, out: JSON.stringify({ username: "ada", team: { id: "t", slug: "ada-team" } }) }), { loggedIn: true, username: "ada", teamSlug: "ada-team" });
  assert.deepEqual(parseVercelWhoami({ ok: true, out: JSON.stringify({ username: "ada", team: null }) }), { loggedIn: true, username: "ada", teamSlug: "" });
  assert.equal(parseVercelWhoami({ ok: false, out: JSON.stringify({ loggedIn: false }) }).loggedIn, false);

  assert.equal(vercelFailure({ out: JSON.stringify({ status: "error", message: "Multiple teams found.", next: [{ command: "vercel link --team <slug>" }] }), err: "Vercel CLI 65.2.0" }), "Multiple teams found. (try: vercel link --team <slug>)");
  assert.equal(vercelFailure({ out: "", err: "Error: build failed\nVercel CLI 65.2.0" }), "Error: build failed");
  assert.deepEqual(parseJsonOutput('Vercel CLI 1.0\n{"a":1}\n'), { a: 1 });
});

test("--person adds to a real team and replaces only the sample people", () => {
  const team = [
    { id: "ada", name: "Ada Lovelace", focus: "UI", github: "ada-l" },
    { id: "grace", name: "Grace Hopper", focus: "", github: "" },
  ];
  const merged = mergePeople(team, [{ name: "Linus T", github: "linus-t" }, { name: "Grace Hopper", github: "grace-h" }]);
  assert.deepEqual(merged.map((person) => [person.id, person.github]), [["ada", "ada-l"], ["grace", "grace-h"], ["linus", "linus-t"]]);
  assert.equal(mergePeople(team, [{ id: "ada", focus: "Backend", name: "" }])[0].focus, "Backend");
  assert.equal(isSampleEvent({ name: "Sample Hackathon", slug: "sample-hackathon" }), true);
  assert.equal(isSampleEvent({ name: "Winter Build", slug: "winter-build" }), false);
});

// ---------- end to end, with fake gh and vercel ----------

// CommonJS on purpose: an extensionless file is not read as a module on Node 20.
// It models the real CLIs' shapes: vercel whoami --json, deploy --json (plain, or
// wrapped as under a coding agent with FAKE_DEPLOY_MODE=agent), and errors as JSON on stdout.
const FAKE_TOOL = String.raw`#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const { execFileSync } = require("node:child_process");

const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
let stdin = "";
try { stdin = readFileSync(0, "utf8"); } catch {}
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool, args, stdin }) + "\n");
const statePath = process.env.FAKE_STATE;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
state.invited ??= []; state.projects ??= []; state.env ??= {};
const save = () => writeFileSync(statePath, JSON.stringify(state));
// GitHub user ids are sequential and far below 9,000,000,000, so these can never be a real account.
const ids = { "ada-gh": 9000000001, "grace-gh": 9000000002, "linus-gh": 9000000003, "alan-gh": 9000000004 };
const out = (text) => process.stdout.write(text + "\n");
const fail = (message) => { out(JSON.stringify({ status: "error", reason: "fake", message })); process.stderr.write("\nVercel CLI 65.2.0\n"); process.exit(1); };
const scopeAt = args.indexOf("--scope");
const plain = scopeAt >= 0 ? args.slice(0, scopeAt) : args;
const line = plain.join(" ");

if (args[0] === "--version") { out(tool + " 1.0.0"); process.exit(0); }
if (tool === "gh") {
  if (line === "api user --jq .login") { out("ada-gh"); process.exit(0); }
  let match = /^api users\/([^ ]+) --jq \.id$/.exec(line);
  if (match) { if (ids[match[1]]) { out(String(ids[match[1]])); process.exit(0); } process.exit(1); }
  if (args[0] === "repo" && args[1] === "create") {
    execFileSync("git", ["remote", "add", "origin", process.env.FAKE_BARE]);
    execFileSync("git", ["push", "-q", "-u", "origin", "HEAD:refs/heads/main"]);
    process.exit(0);
  }
  match = /^api repos\/[^ ]+\/invitations --jq/.exec(line);
  if (match) { out(state.invited.join("\n")); process.exit(0); }
  match = /^api -X PUT repos\/[^ ]+\/collaborators\/([^ ]+) -f permission=push --silent$/.exec(line);
  if (match) { state.invited.push(match[1]); save(); process.exit(0); }
  if (/^api repos\/[^ ]+\/collaborators\/[^ ]+ --silent$/.test(line)) process.exit(1);
  process.exit(9);
}
if (tool === "vercel") {
  if (plain[0] === "whoami") { out(JSON.stringify({ username: "tester", team: { id: "team_x", slug: "tester-team", name: "Tester" } })); process.exit(0); }
  if (plain[0] === "project" && plain[1] === "inspect") { if (state.projects.includes(plain[2])) process.exit(0); fail("Project not found"); }
  if (plain[0] === "project" && plain[1] === "create") { state.projects.push(plain[2]); save(); process.exit(0); }
  if (plain[0] === "link") {
    if (!plain.includes("--team")) fail("Multiple teams found. Re-run this command with --team <slug>");
    mkdirSync(".vercel", { recursive: true }); writeFileSync(join(".vercel", "project.json"), "{}"); process.exit(0);
  }
  if (plain[0] === "env" && plain[1] === "list") { out(JSON.stringify({ envs: Object.keys(state.env).map((key) => ({ key })) })); process.exit(0); }
  if (plain[0] === "env" && plain[1] === "add") { state.env[plain[2]] = stdin; save(); process.exit(0); }
  if (plain[0] === "deploy") {
    if (process.env.FAKE_DEPLOY_MODE === "fail") fail("Build failed: the fake was told to fail");
    const deployment = { id: "dpl_1", url: "https://sample-hackathon-hub-abc123-tester.vercel.app", productionUrl: process.env.FAKE_PRODUCTION_URL || null, readyState: "READY", target: "production" };
    out(JSON.stringify(process.env.FAKE_DEPLOY_MODE === "agent" ? { status: "ok", deployment, message: "Deployment ready. Production URL: " + deployment.productionUrl + '",', next: [] } : deployment, null, 2));
    process.exit(0);
  }
  if (plain[0] === "inspect") { out(JSON.stringify({ aliases: ["sample-hackathon-hub-tester.vercel.app", "sample-hackathon-hub.vercel.app"] })); process.exit(0); }
  process.exit(9);
}
process.exit(9);
`;

const FAKE_HUB_CLI = String.raw`import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool: "hub", args, me: process.env.HUB_ME }) + "\n");
if (args[0] !== "add" || !args.includes("--no-commit")) process.exit(9);
const flag = (name) => args[args.indexOf("--" + name) + 1];
const id = Date.now() + "-" + process.env.HUB_ME + "-" + Math.random().toString(36).slice(2, 6);
mkdirSync("events/2027-01-16", { recursive: true });
writeFileSync("events/2027-01-16/" + id + ".json", JSON.stringify({ v: 1, id, by: process.env.HUB_ME, type: "item.add", ref: "t-" + id.slice(-4), title: args[1], data: { why: flag("why"), owner: flag("owner"), area: flag("area") } }, null, 2) + "\n");
`;

function which(name) {
  const found = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return found.stdout.trim();
}

function makeSandbox({ withHubCli = true, fakes = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "hub-setup-"));
  const hubDir = join(root, "hub");
  mkdirSync(join(hubDir, "docs"), { recursive: true });
  for (const path of ["hub.config.json", "team.json", "lib", "scripts/setup.mjs", "scripts/setup", "docs/agent-prompt.template.md", "docs/agent-prompt.md", "hub"]) {
    cpSync(join(templateRoot, path), join(hubDir, path), { recursive: true });
  }
  if (withHubCli) writeFileSync(join(hubDir, "scripts", "hub.mjs"), FAKE_HUB_CLI);
  writeFileSync(join(hubDir, ".gitignore"), "node_modules/\n");

  // A bin folder holding only what setup may use, so the real gh and vercel stay out of reach.
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(which("git"), join(bin, "git"));
  if (fakes) {
    for (const tool of ["gh", "vercel"]) {
      writeFileSync(join(bin, tool), FAKE_TOOL);
      chmodSync(join(bin, tool), 0o755);
    }
  }
  const bare = join(root, "origin.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const home = join(root, "home");
  mkdirSync(home);
  writeFileSync(join(home, ".gitconfig"), "");
  // gh and vercel only exist as fakes here; /usr/bin may hold a real gh on CI, so PATH starts with bin.
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    FAKE_LOG: join(root, "calls.jsonl"),
    FAKE_STATE: join(root, "fake-state.json"),
    FAKE_BARE: bare,
    LANG: "C",
  };
  return { root, hubDir, env, bare };
}

// Async, so the stand-in board below can answer while setup runs.
function runSetup(box, args, extraEnv = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(box.hubDir, "scripts", "setup.mjs"), ...args], { cwd: box.hubDir, env: { ...box.env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdin.end();
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

// A stand-in for the deployed board: the unlock link sets hub_session when the
// key matches the HUB_KEY the fake vercel stored, and home needs that cookie.
async function startBoard(box) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const state = existsSync(box.env.FAKE_STATE) ? JSON.parse(readFileSync(box.env.FAKE_STATE, "utf8")) : { env: {} };
    if (url.pathname === "/unlock" && state.env?.HUB_KEY && url.searchParams.get("key") === state.env.HUB_KEY) {
      response.writeHead(307, { location: "/", "set-cookie": "hub_session=signed; Path=/; HttpOnly" });
      return response.end();
    }
    if (url.pathname === "/" && /hub_session=signed/.test(request.headers.cookie ?? "")) {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end("<h1>Board</h1>");
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  // The fake deploy reports this as the production URL, so no test reaches the network.
  box.env.FAKE_PRODUCTION_URL = url;
  return { url, close: () => new Promise((done) => server.close(done)) };
}

function calls(box) {
  if (!existsSync(box.env.FAKE_LOG)) return [];
  return readFileSync(box.env.FAKE_LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function snapshot(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".git") walk(path);
      } else files[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return files;
}

const MUTATING = [/^repo create/, /^api -X PUT/, /^env add/, /^deploy/, /^link/, /^project create/];
function mutatingCalls(list) {
  return list.filter((call) => call.tool === "hub" || MUTATING.some((pattern) => pattern.test(call.args.join(" "))));
}

function envAdds(list, name) {
  return list.filter((call) => call.tool === "vercel" && call.args[0] === "env" && call.args[1] === "add" && call.args[2] === name);
}

const PEOPLE = [
  "--person", "name=Ada Example;id=ada;github=ada-gh;focus=Product and frontend",
  "--person", "name=Grace Example;id=grace;github=grace-gh;focus=Backend and data",
  "--person", "name=Linus Example;id=linus;github=linus-gh;focus=Hardware and infrastructure",
];

const FULL_ARGS = [
  "--yes",
  "--name", "Sample Hackathon",
  "--timezone", "America/New_York",
  "--starts", "2027-01-16 10:00",
  "--submit-by", "2027-01-17 09:00",
  ...PEOPLE,
  "--save-link",
];

function gitOut(box, args, cwd = box.hubDir) {
  return spawnSync("git", args, { cwd, env: box.env, encoding: "utf8" }).stdout.trim();
}

test("--yes --dry-run prints the plan, the accounts, and where the real run would stop, and changes nothing", async () => {
  const box = makeSandbox();
  const before = snapshot(box.hubDir);
  const result = await runSetup(box, ["--yes", "--dry-run", "--timezone", "America/New_York"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.match(result.stdout, /gh logged in as ada-gh, vercel logged in as tester, scope tester-team/);
  assert.match(result.stdout, /Event details\s+stop\s+hub\.config\.json still names the sample event/);
  assert.match(result.stdout, /Team\s+stop\s+team\.json still holds the sample people/);
  assert.match(result.stdout, /Git and GitHub\s+todo\s+git init, commit, create private repo ada-gh\/sample-hackathon-hub/);
  assert.match(result.stdout, /create or link Vercel project sample-hackathon-hub in scope tester-team/);
  assert.match(result.stdout, /The real run would stop/);
  assert.match(result.stdout, /user\.name or user\.email is not set/);
  assert.deepEqual(snapshot(box.hubDir), before);
  assert.ok(!existsSync(join(box.hubDir, ".git")));
  assert.deepEqual(mutatingCalls(calls(box)), []);
});

test("--yes stops on the sample event or the sample team before anything is written or created", async () => {
  for (const [args, message] of [
    [["--yes", "--timezone", "UTC", ...PEOPLE], /still names the sample event/],
    [["--yes", "--timezone", "UTC", "--name", "Winter Build"], /still holds the sample people/],
  ]) {
    const box = makeSandbox();
    const before = snapshot(box.hubDir);
    const result = await runSetup(box, args);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stderr, message);
    assert.deepEqual(snapshot(box.hubDir), before);
    assert.deepEqual(mutatingCalls(calls(box)), []);
  }
});

test("a full run sets up the hub, checks the board, and a second run changes nothing", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const first = await runSetup(box, FULL_ARGS);
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /git identity: not set/);
  assert.match(first.stdout, /git config --global user\.email/);
  assert.match(first.stdout, /GitHub account ada-gh/);
  assert.match(first.stdout, /Vercel account tester, scope tester-team/);

  const config = JSON.parse(readFileSync(join(box.hubDir, "hub.config.json"), "utf8"));
  assert.equal(config.event.startsAt, "2027-01-16T10:00:00-05:00");
  assert.equal(config.event.submitBy, "2027-01-17T09:00:00-05:00");
  assert.equal(config.hub.repo, "ada-gh/sample-hackathon-hub");
  assert.equal(config.hub.owner, "ada");

  const team = JSON.parse(readFileSync(join(box.hubDir, "team.json"), "utf8"));
  assert.deepEqual(team.people.map((person) => [person.id, person.githubId, person.commitEmail]), [
    ["ada", 9000000001, "9000000001+ada-gh@users.noreply.github.com"],
    ["grace", 9000000002, "9000000002+grace-gh@users.noreply.github.com"],
    ["linus", 9000000003, "9000000003+linus-gh@users.noreply.github.com"],
  ]);

  const prompt = readFileSync(join(box.hubDir, "docs", "agent-prompt.md"), "utf8");
  assert.match(prompt, /git clone https:\/\/github\.com\/ada-gh\/sample-hackathon-hub\.git ~\/sample-hackathon\/hub/);
  assert.ok(!prompt.includes("{{"));

  const events = readdirSync(join(box.hubDir, "events", "2027-01-16")).map((file) => JSON.parse(readFileSync(join(box.hubDir, "events", "2027-01-16", file), "utf8")));
  assert.deepEqual(events.map((event) => event.data.owner).sort(), ["ada", "grace", "linus"]);
  assert.ok(events.every((event) => event.data.area === "onboarding" && event.by === "ada"));

  const list = calls(box);
  const order = mutatingCalls(list).map((call) => `${call.tool} ${call.args.slice(0, 3).join(" ")}`);
  assert.deepEqual(order, [
    "hub add Connect your coding agent to the hub --why",
    "hub add Connect your coding agent to the hub --why",
    "hub add Connect your coding agent to the hub --why",
    "gh repo create ada-gh/sample-hackathon-hub",
    "gh api -X PUT",
    "gh api -X PUT",
    "vercel project create sample-hackathon-hub",
    "vercel link --yes --project",
    "vercel env add HUB_KEY",
    "vercel env add HUB_REPO",
    "vercel deploy --prod --yes",
  ]);
  const invites = list.filter((call) => call.args.includes("PUT")).map((call) => call.args[3]);
  assert.deepEqual(invites, ["repos/ada-gh/sample-hackathon-hub/collaborators/grace-gh", "repos/ada-gh/sample-hackathon-hub/collaborators/linus-gh"]);

  // One scope for every Vercel call; link names it with --team, because without a TTY the CLI never picks one.
  const vercelCalls = list.filter((call) => call.tool === "vercel" && !["--version", "whoami"].includes(call.args[0]));
  for (const call of vercelCalls) {
    if (call.args[0] === "link") assert.deepEqual(call.args.slice(-2), ["--team", "tester-team"]);
    else assert.deepEqual(call.args.slice(-2), ["--scope", "tester-team"], call.args.join(" "));
  }
  assert.ok(list.find((call) => call.args[0] === "deploy").args.includes("--json"));

  // The key reaches Vercel on stdin. --yes keeps it and the link out of the output.
  const key = envAdds(list, "HUB_KEY")[0].stdin;
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(list.every((call) => !call.args.join(" ").includes(key)), "the key reached argv");
  assert.ok(!first.stdout.includes(key) && !first.stderr.includes(key), "the key reached the output");
  assert.ok(!first.stdout.includes("/unlock?key="), "the link reached the output");
  assert.match(first.stdout, /Unlock link saved in \.hub-owner\.local/);
  assert.match(first.stdout, /Board check passed/);
  assert.match(first.stdout, /Pushing to the repo never deploys the board/);
  assert.match(first.stdout, /need a token from you,[\s\S]*settings\/personal-access-tokens\/new\?name=sample-hackathon-hub\+cloud\+agent/);

  // The saved link is private, never tracked, and the Vercel CLI is told to skip machine-local files.
  const linkFile = join(box.hubDir, ".hub-owner.local");
  assert.equal(readFileSync(linkFile, "utf8"), `${board.url}/unlock?key=${key}\n`);
  assert.equal(statSync(linkFile).mode & 0o777, 0o600);
  const vercelignore = readFileSync(join(box.hubDir, ".vercelignore"), "utf8").split("\n");
  for (const name of [".hub-owner.local", ".hub-setup.local.json", ".hub-me", ".claude/settings.local.json", ".env*"]) assert.ok(vercelignore.includes(name), name);
  const tracked = gitOut(box, ["ls-files", "-s"]).split("\n");
  assert.ok(tracked.some((line) => line.startsWith("100755") && line.endsWith("\thub")), "hub is committed executable");
  const paths = tracked.map((line) => line.split("\t")[1]);
  for (const local of [".hub-owner.local", ".hub-setup.local.json", ".vercel/project.json"]) assert.ok(!paths.includes(local), `${local} is tracked`);
  for (const file of paths) assert.ok(!readFileSync(join(box.hubDir, file), "utf8").includes(key), `${file} holds the key`);
  assert.equal(gitOut(box, ["status", "--porcelain"]), "");
  assert.equal(gitOut(box, ["--git-dir", box.bare, "rev-parse", "main"]), gitOut(box, ["rev-parse", "HEAD"]));

  // Second run: same files, same commit, nothing sent anywhere.
  const before = snapshot(box.hubDir);
  const head = gitOut(box, ["rev-parse", "HEAD"]);
  const callsBefore = list.length;
  const second = await runSetup(box, FULL_ARGS);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(snapshot(box.hubDir), before);
  assert.equal(gitOut(box, ["rev-parse", "HEAD"]), head);
  assert.deepEqual(mutatingCalls(calls(box).slice(callsBefore)), []);
  assert.match(second.stdout, /unlock link is in \.hub-owner\.local/);

  // --deploy redeploys and checks again with the saved link, without printing it.
  const third = await runSetup(box, ["--deploy"]);
  assert.equal(third.code, 0, third.stderr);
  assert.deepEqual(mutatingCalls(calls(box).slice(callsBefore)).map((call) => call.args[0]), ["deploy"]);
  assert.match(third.stdout, /Board check passed/);
  assert.ok(!third.stdout.includes(key));
});

test("--deploy on a hub not set up yet runs every step instead of putting the sample hub on Vercel", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  // A sample event with --deploy still stops, as without it.
  const sample = await runSetup(box, ["--yes", "--deploy", "--timezone", "UTC", ...PEOPLE]);
  assert.equal(sample.code, 1, sample.stdout);
  assert.match(sample.stderr, /still names the sample event/);
  assert.deepEqual(mutatingCalls(calls(box)), []);

  const plan = await runSetup(box, [...FULL_ARGS, "--deploy", "--dry-run"]);
  assert.match(plan.stdout, /Git and GitHub\s+todo\s+git init, commit, create private repo/);

  const first = await runSetup(box, [...FULL_ARGS, "--deploy"]);
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  const order = mutatingCalls(calls(box)).map((call) => `${call.tool} ${call.args.slice(0, 2).join(" ")}`);
  assert.ok(order.includes("gh repo create"), order.join("\n"));
  assert.equal(order.filter((line) => line.startsWith("vercel deploy")).length, 1);
  assert.equal(JSON.parse(readFileSync(join(box.hubDir, "hub.config.json"), "utf8")).hub.repo, "ada-gh/sample-hackathon-hub");
  assert.match(first.stdout, /Board check passed/);

  // Once the hub is set up, --deploy alone redeploys, and the dry run says the other steps are skipped.
  const dry = await runSetup(box, ["--deploy", "--dry-run"]);
  assert.match(dry.stdout, /Git and GitHub\s+skip\s+--deploy on a finished hub only redeploys the board/);
  assert.match(dry.stdout, /Board on Vercel\s+todo\s+deploy, save the unlock link in \.hub-owner\.local, and check it from outside/);

  // With the setup flags again, every step runs (and changes nothing), and the board is redeployed once.
  const callsBefore = calls(box).length;
  const again = await runSetup(box, [...FULL_ARGS, "--deploy"]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /team\.json already says this/);
  assert.match(again.stdout, /main is pushed; origin has every commit/);
  assert.deepEqual(mutatingCalls(calls(box).slice(callsBefore)).map((call) => call.args[0]), ["deploy"]);
});

test("a failed deploy after the key is made keeps the key, and the rerun shows its link", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const printing = [...FULL_ARGS.filter((arg) => arg !== "--save-link"), "--print-link"];
  const failed = await runSetup(box, printing, { FAKE_DEPLOY_MODE: "fail" });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /vercel deploy failed: Build failed: the fake was told to fail/);
  assert.match(failed.stderr, /new unlock key is kept in \.hub-owner\.local/);
  const key = envAdds(calls(box), "HUB_KEY")[0].stdin;
  assert.ok(!failed.stdout.includes(key) && !failed.stderr.includes(key));
  assert.match(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8"), new RegExp(`^HUB_KEY=${key}$`, "m"));

  const callsBefore = calls(box).length;
  const rerun = await runSetup(box, printing);
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.ok(rerun.stdout.includes(`${board.url}/unlock?key=${key}`), "the rerun shows the kept key's link");
  assert.match(rerun.stdout, /Board check passed/);
  assert.deepEqual(envAdds(calls(box).slice(callsBefore), "HUB_KEY"), [], "the key is not replaced");
  assert.ok(!existsSync(join(box.hubDir, ".hub-owner.local")), "without --save-link nothing is left on disk");
  assert.doesNotMatch(rerun.stdout, /earlier run/);
});

test("a failed key write is retried with the same key on the next run", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  writeFileSync(box.env.FAKE_STATE, JSON.stringify({}));
  // A vercel that refuses env add: the run stops right after the key is made.
  const brokenBin = join(box.root, "broken-bin");
  mkdirSync(brokenBin);
  writeFileSync(join(brokenBin, "vercel"), `#!/bin/sh\nif [ "$1" = env ] && [ "$2" = add ]; then cat >/dev/null; echo '{"status":"error","message":"env add refused"}'; exit 1; fi\nexec "${join(box.root, "bin", "vercel")}" "$@"\n`);
  chmodSync(join(brokenBin, "vercel"), 0o755);
  const failed = await runSetup(box, FULL_ARGS, { PATH: `${brokenBin}:${box.env.PATH}` });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /vercel env add HUB_KEY failed: env add refused/);
  const kept = /^HUB_KEY=(\S+)$/m.exec(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8"))[1];
  const rerun = await runSetup(box, FULL_ARGS);
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.equal(envAdds(calls(box), "HUB_KEY").at(-1).stdin, kept);
  assert.ok(!rerun.stdout.includes(kept));
  assert.ok(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8").includes(`/unlock?key=${kept}`));
});

test("an existing Vercel project is reused only when named, and then gets a new key", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  writeFileSync(box.env.FAKE_STATE, JSON.stringify({ projects: ["sample-hackathon-hub"], env: { HUB_KEY: "old-key-from-last-year" } }));
  const refused = await runSetup(box, FULL_ARGS);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /A Vercel project named sample-hackathon-hub already exists in scope tester-team/);
  assert.match(refused.stderr, /--vercel-project sample-hackathon-hub/);
  assert.deepEqual(mutatingCalls(calls(box)).filter((call) => call.tool === "vercel"), []);

  const reused = await runSetup(box, [...FULL_ARGS, "--vercel-project", "sample-hackathon-hub"]);
  assert.equal(reused.code, 0, reused.stderr);
  assert.match(reused.stdout, /Reusing the existing Vercel project sample-hackathon-hub/);
  const newKey = envAdds(calls(box), "HUB_KEY")[0].stdin;
  assert.notEqual(newKey, "old-key-from-last-year");
  assert.ok(!reused.stdout.includes(newKey));
  assert.ok(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8").includes(`/unlock?key=${newKey}`));
});

test("a coding agent's wrapped deploy output still gives a clean board address", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const result = await runSetup(box, [...FULL_ARGS, "--print-link"], { FAKE_DEPLOY_MODE: "agent" });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Live at ${board.url}\\n`));
  assert.match(result.stdout, new RegExp(`  ${board.url}/unlock\\?key=[A-Za-z0-9_-]{43}\\n`));
  assert.match(result.stdout, /Board check passed/);
});

test("--new-key without --save-link removes the old saved link", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  assert.equal((await runSetup(box, FULL_ARGS)).code, 0);
  assert.ok(existsSync(join(box.hubDir, ".hub-owner.local")));
  const rotated = await runSetup(box, ["--deploy", "--new-key", "--print-link"]);
  assert.equal(rotated.code, 0, rotated.stderr);
  assert.ok(!existsSync(join(box.hubDir, ".hub-owner.local")));
  const later = await runSetup(box, ["--deploy", "--save-link"]);
  assert.equal(later.code, 0, later.stderr);
  assert.match(later.stdout, /--save-link: nothing to save/);
  assert.match(later.stdout, /shown when its key was made/);
});

// The flags of FULL_ARGS without --yes, with every question answered, so a run on a terminal asks nothing.
const TERMINAL_ARGS = [...FULL_ARGS.filter((arg) => arg !== "--yes" && arg !== "--save-link"), "--slug", "sample-hackathon", "--location", "Online", "--skip-tokens"];

test("output that is not a terminal never gets the unlock link; it goes to the owner file", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  // First with --yes, then without it (still not a terminal): the rerun neither prints nor rotates the key.
  for (const [index, args] of [FULL_ARGS.filter((arg) => arg !== "--save-link"), TERMINAL_ARGS].entries()) {
    const run = await runSetup(box, args);
    assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
    const key = envAdds(calls(box), "HUB_KEY")[0].stdin;
    for (const text of [run.stdout, run.stderr]) {
      assert.ok(!text.includes(key), "the key reached the output");
      assert.ok(!text.includes("/unlock?key="), "the link reached the output");
    }
    if (index === 0) {
      assert.match(run.stdout, /Unlock link saved in \.hub-owner\.local[\s\S]*kept out of this\s+output on purpose/);
      assert.match(run.stdout, /Board check passed/);
    } else {
      assert.match(run.stdout, /The unlock link is in \.hub-owner\.local/);
    }
    assert.match(run.stdout, /Where it says <UNLOCK_LINK>, paste the link from \.hub-owner\.local/);
    const linkFile = join(box.hubDir, ".hub-owner.local");
    assert.equal(readFileSync(linkFile, "utf8"), `${board.url}/unlock?key=${key}\n`);
    assert.equal(statSync(linkFile).mode & 0o777, 0o600);
    assert.equal(gitOut(box, ["check-ignore", ".hub-owner.local"]), ".hub-owner.local");
  }
  assert.equal(envAdds(calls(box), "HUB_KEY").length, 1);

  // --new-key follows the same rule: a new key, in the file, not in the output.
  const oldKey = envAdds(calls(box), "HUB_KEY")[0].stdin;
  const rotated = await runSetup(box, ["--deploy", "--new-key"]);
  assert.equal(rotated.code, 0, rotated.stderr);
  const newKey = envAdds(calls(box), "HUB_KEY").at(-1).stdin;
  assert.notEqual(newKey, oldKey);
  assert.ok(!rotated.stdout.includes(newKey) && !rotated.stdout.includes("/unlock?key="));
  assert.equal(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8"), `${board.url}/unlock?key=${newKey}\n`);
});

test("--print-link prints the unlock link into a pipe", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const run = await runSetup(box, [...FULL_ARGS.filter((arg) => arg !== "--save-link"), "--print-link"]);
  assert.equal(run.code, 0, run.stderr);
  const key = envAdds(calls(box), "HUB_KEY")[0].stdin;
  assert.ok(run.stdout.includes(`${board.url}/unlock?key=${key}`));
  assert.equal(run.stdout.split(key).length - 1, 1);
  assert.match(run.stdout, /Put the unlock link where it says <UNLOCK_LINK>/);
  assert.ok(!existsSync(join(box.hubDir, ".hub-owner.local")), "without --save-link nothing is left on disk");
});

// Runs setup with a real pseudo-terminal as its stdout, through script(1). Null when this machine has no usable one.
function runSetupInTerminal(box, args) {
  const setup = join(box.hubDir, "scripts", "setup.mjs");
  const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
  const command = process.platform === "darwin"
    ? ["script", ["-q", "/dev/null", process.execPath, setup, ...args]]
    : process.platform === "linux"
      ? ["script", ["-qec", [process.execPath, setup, ...args].map(quote).join(" "), "/dev/null"]]
      : null;
  if (!command || !which("script")) return Promise.resolve(null);
  return new Promise((done) => {
    // stdin is /dev/null: script(1) needs a real file there, and setup then reads end of input at once.
    const child = spawn(command[0], command[1], { cwd: box.hubDir, env: box.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stdout += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", () => done(null));
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout });
    });
  });
}

test("on a terminal, setup prints the unlock link once, and --save-link also keeps it", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const run = await runSetupInTerminal(box, TERMINAL_ARGS);
  if (!run) return t.skip("no script(1) for a pseudo-terminal here");
  assert.equal(run.code, 0, run.stdout);
  const key = envAdds(calls(box), "HUB_KEY")[0].stdin;
  assert.ok(run.stdout.includes(`${board.url}/unlock?key=${key}`), run.stdout);
  assert.equal(run.stdout.split(key).length - 1, 1);
  assert.ok(!existsSync(join(box.hubDir, ".hub-owner.local")), "without --save-link nothing is left on disk");

  const saved = await runSetupInTerminal(box, ["--deploy", "--new-key", "--save-link"]);
  assert.equal(saved.code, 0, saved.stdout);
  const newKey = envAdds(calls(box), "HUB_KEY").at(-1).stdin;
  assert.ok(saved.stdout.includes(`/unlock?key=${newKey}`));
  assert.equal(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8"), `${board.url}/unlock?key=${newKey}\n`);
});

test("a private write is 0600 under umask 000, narrows an older wide copy, and leaves no temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-private-"));
  const file = join(dir, ".hub-owner.local");
  const previous = process.umask(0);
  try {
    assert.equal(writeIfChanged(file, "one\n", { mode: 0o600 }), true);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    chmodSync(file, 0o644);
    assert.equal(writeIfChanged(file, "one\n", { mode: 0o600 }), false, "same bytes are not rewritten");
    assert.equal(statSync(file).mode & 0o777, 0o600, "but the mode is narrowed");
    chmodSync(file, 0o666);
    assert.equal(writeIfChanged(file, "two\n", { mode: 0o600 }), true);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, "utf8"), "two\n");
    // A link planted at the target is replaced, not followed.
    const elsewhere = join(dir, "elsewhere.txt");
    writeFileSync(elsewhere, "two\n");
    rmSync(file);
    symlinkSync(elsewhere, file);
    assert.equal(writeIfChanged(file, "two\n", { mode: 0o600 }), true);
    assert.ok(!lstatSync(file).isSymbolicLink());
    assert.equal(statSync(elsewhere).mode & 0o777, 0o666, "the link's target is untouched");
    assert.deepEqual(readdirSync(dir).sort(), [".hub-owner.local", "elsewhere.txt"]);
  } finally {
    process.umask(previous);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("under umask 000, setup still writes the owner file as 0600", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const previous = process.umask(0);
  let run;
  try {
    run = await runSetup(box, FULL_ARGS);
  } finally {
    process.umask(previous);
  }
  assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
  assert.equal(statSync(join(box.hubDir, ".hub-owner.local")).mode & 0o777, 0o600);
});

// A refusal must name the problem and leave the key nowhere: not in the output, not on Vercel.
function assertRefusedWithoutKey(box, run, reason) {
  assert.equal(run.code, 1, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /Refusing to write the unlock key or link to \.hub-owner\.local/);
  assert.match(run.stderr, reason);
  for (const text of [run.stdout, run.stderr]) {
    assert.ok(!text.includes("HUB_KEY="), "the key reached the output");
    assert.ok(!text.includes("/unlock?key="), "the link reached the output");
    assert.doesNotMatch(text, /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/, "something key-shaped reached the output");
  }
  assert.deepEqual(envAdds(calls(box), "HUB_KEY"), [], "the key reached Vercel");
}

test("a tracked .hub-owner.local is refused, and the key goes nowhere", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  const ident = ["-c", "user.name=Ada Example", "-c", "user.email=1+ada@users.noreply.github.com"];
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: box.hubDir, env: box.env });
  writeFileSync(join(box.hubDir, ".hub-owner.local"), "placeholder\n");
  spawnSync("git", ["add", "-A"], { cwd: box.hubDir, env: box.env });
  spawnSync("git", ["add", "-f", ".hub-owner.local"], { cwd: box.hubDir, env: box.env });
  spawnSync("git", [...ident, "commit", "-q", "-m", "Start"], { cwd: box.hubDir, env: box.env });
  assert.equal(gitOut(box, ["ls-files", ".hub-owner.local"]), ".hub-owner.local");
  const run = await runSetup(box, FULL_ARGS);
  assertRefusedWithoutKey(box, run, /is tracked by git[\s\S]*git rm --cached \.hub-owner\.local/);
  assert.equal(readFileSync(join(box.hubDir, ".hub-owner.local"), "utf8"), "placeholder\n");
});

test("a .gitignore negation of .hub-owner.local is refused, and the key goes nowhere", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  writeFileSync(join(box.hubDir, ".gitignore"), "node_modules/\n.hub-owner.local\n!.hub-owner.local\n");
  const run = await runSetup(box, FULL_ARGS);
  assertRefusedWithoutKey(box, run, /git does not ignore \.hub-owner\.local/);
  assert.ok(!existsSync(join(box.hubDir, ".hub-owner.local")));
});

test("the template's .gitignore covers the owner file", () => {
  const lines = readFileSync(join(templateRoot, ".gitignore"), "utf8").split("\n").map((line) => line.trim());
  assert.ok(lines.includes(".hub-owner.local"));
});

test("--tokens sets one token as both board variables, through stdin only", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  assert.equal((await runSetup(box, FULL_ARGS)).code, 0);
  const callsBefore = calls(box).length;
  const token = "github_pat_ONE_example_value_0001";
  const result = await runSetup(box, ["--tokens", "--yes"], { HUB_TOKEN: token });
  assert.equal(result.code, 0, result.stderr);
  const list = calls(box).slice(callsBefore);
  const added = list.filter((call) => call.args[0] === "env" && call.args[1] === "add");
  assert.deepEqual(added.map((call) => [call.args[2], call.stdin]), [["HUB_READ_TOKEN", token], ["HUB_WRITE_TOKEN", token]]);
  assert.ok(added.every((call) => call.args.includes("--sensitive")));
  assert.ok(list.some((call) => call.tool === "vercel" && call.args[0] === "deploy"));
  assert.ok(list.every((call) => !call.args.join(" ").includes(token)));
  assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
  assert.match(result.stdout, /Board check passed/);
});

test("--tokens --yes without the token in the environment stops and names the variable", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  assert.equal((await runSetup(box, FULL_ARGS)).code, 0);
  for (const [args, variable] of [[["--tokens", "--yes"], "HUB_TOKEN"], [["--tokens", "--yes", "--separate-tokens"], "HUB_WRITE_TOKEN"]]) {
    const callsBefore = calls(box).length;
    const started = Date.now();
    const result = await runSetup(box, args, args.includes("--separate-tokens") ? { HUB_READ_TOKEN: "github_pat_x" } : {});
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`${variable} is not set`));
    assert.ok(Date.now() - started < 10000, "no paste loop");
    assert.deepEqual(mutatingCalls(calls(box).slice(callsBefore)), []);
  }
  // Without --yes and with input already closed, the paste prompt stops instead of looping.
  const closed = await runSetup(box, ["--tokens"]);
  assert.equal(closed.code, 1);
  assert.match(closed.stderr, /Input ended before the board token was pasted/);
});

test("--separate-tokens reads a read token and a write token", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  assert.equal((await runSetup(box, FULL_ARGS)).code, 0);
  const callsBefore = calls(box).length;
  const read = "github_pat_READ_example_value_0001";
  const write = "github_pat_WRITE_example_value_0002";
  const result = await runSetup(box, ["--tokens", "--separate-tokens", "--yes"], { HUB_READ_TOKEN: read, HUB_WRITE_TOKEN: write });
  assert.equal(result.code, 0, result.stderr);
  const list = calls(box).slice(callsBefore);
  assert.equal(envAdds(list, "HUB_READ_TOKEN")[0].stdin, read);
  assert.equal(envAdds(list, "HUB_WRITE_TOKEN")[0].stdin, write);
  for (const secret of [read, write]) {
    assert.ok(list.every((call) => !call.args.join(" ").includes(secret)));
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
  }
});

test("adding a late teammate keeps the team and the owner, and the push takes teammates' commits first", async (t) => {
  const box = makeSandbox();
  const board = await startBoard(box);
  t.after(board.close);
  assert.equal((await runSetup(box, FULL_ARGS)).code, 0);
  // A teammate pushes an event meanwhile.
  const other = join(box.root, "teammate");
  spawnSync("git", ["clone", "-q", box.bare, other], { env: box.env });
  mkdirSync(join(other, "events", "2027-01-16"), { recursive: true });
  writeFileSync(join(other, "events", "2027-01-16", "from-grace.json"), "{}\n");
  spawnSync("git", ["add", "-A"], { cwd: other, env: box.env });
  spawnSync("git", ["-c", "user.name=Grace", "-c", "user.email=grace@example.com", "commit", "-q", "-m", "event"], { cwd: other, env: box.env });
  spawnSync("git", ["push", "-q"], { cwd: other, env: box.env });

  const result = await runSetup(box, ["--yes", "--person", "name=Alan Example;github=alan-gh"]);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const team = JSON.parse(readFileSync(join(box.hubDir, "team.json"), "utf8"));
  assert.deepEqual(team.people.map((person) => person.id), ["ada", "grace", "linus", "alan"]);
  assert.equal(JSON.parse(readFileSync(join(box.hubDir, "hub.config.json"), "utf8")).hub.owner, "ada");
  assert.match(result.stdout, /Pushed main/);
  assert.ok(existsSync(join(box.hubDir, "events", "2027-01-16", "from-grace.json")));
  assert.equal(gitOut(box, ["--git-dir", box.bare, "rev-parse", "main"]), gitOut(box, ["rev-parse", "HEAD"]));
  assert.ok(calls(box).some((call) => call.args.join(" ").endsWith("collaborators/alan-gh -f permission=push --silent")));
});

test("without gh and vercel, the GitHub and board steps print what to do by hand", async () => {
  const box = makeSandbox({ fakes: false, withHubCli: false });
  const result = await runSetup(box, ["--yes", "--timezone", "UTC", "--name", "Winter Build", ...PEOPLE]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /These steps will be by hand/);
  assert.match(result.stdout, /Skipped: scripts\/hub\.mjs is not in this folder/);
  assert.match(result.stdout, /Create a PRIVATE repo named winter-build-hub/);
  assert.match(result.stdout, /npm i -g vercel && vercel login/);
  assert.equal(gitOut(box, ["status", "--porcelain"]), "");
  assert.ok(gitOut(box, ["log", "--oneline"]).includes("Set up the hub for Winter Build"));
});

test("by hand, the invite list leaves out the owner", async () => {
  const box = makeSandbox({ fakes: false, withHubCli: false });
  // Point the GitHub URL at the local bare repo, so the push stays on this machine.
  writeFileSync(box.env.GIT_CONFIG_GLOBAL, `[url "${box.bare}"]\n\tinsteadOf = https://github.com/ada-gh/winter-build-hub.git\n`);
  const result = await runSetup(box, ["--yes", "--timezone", "UTC", "--name", "Winter Build", ...PEOPLE, "--repo", "ada-gh/winter-build-hub"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Invite by hand at https:\/\/github\.com\/ada-gh\/winter-build-hub\/settings\/access with write access: grace-gh, linus-gh\n/);
});

test("a bad flag stops setup before anything is written", async () => {
  for (const [args, message] of [
    [["--yes", "--timezone", "Mars/Olympus", "--name", "X", ...PEOPLE], /not a time zone/],
    [["--yes", "--timezone", "UTC", "--name", "X", ...PEOPLE, "--repo", "acme/hub;x"], /--repo "acme\/hub;x" must be owner\/name/],
  ]) {
    const box = makeSandbox();
    const before = snapshot(box.hubDir);
    const result = await runSetup(box, args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, message);
    assert.deepEqual(snapshot(box.hubDir), before);
    assert.ok(!existsSync(join(box.hubDir, ".git")));
  }
});

// ---------- the board check on its own ----------

function fakeResponse(status, headers = {}) {
  return new Response(null, { status, headers });
}

test("the board check follows the unlock link and loads home with the cookie", async () => {
  const seen = [];
  const result = await verifyBoard("https://board.example.org/", "/hub", "k", {
    attempts: 1,
    fetchImpl: async (url, options) => {
      seen.push([url, options.headers?.cookie ?? ""]);
      return url.includes("/unlock") ? fakeResponse(307, { location: "/hub", "set-cookie": "hub_session=abc; Path=/hub" }) : fakeResponse(200);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [["https://board.example.org/hub/unlock?key=k", ""], ["https://board.example.org/hub", "hub_session=abc"]]);
});

test("the board check names what failed without repeating the key", async () => {
  const cases = [
    [async () => fakeResponse(404), "unlock link", /does not know this key/],
    [async () => fakeResponse(302, { location: "https://vercel.com/sso-api?x" }), "unlock link", /Deployment Protection/],
    [async () => fakeResponse(307, { location: "/" }), "unlock link", /no hub_session cookie/],
    [async (url) => (url.includes("/unlock") ? fakeResponse(307, { "set-cookie": "hub_session=a" }) : fakeResponse(500)), "home page", /HTTP 500/],
    [async () => { throw new TypeError("fetch failed"); }, "unlock link", /could not connect/],
  ];
  for (const [fetchImpl, step, detail] of cases) {
    const result = await verifyBoard("https://board.example.org", "", "secret-key-value", { fetchImpl, attempts: 2, waitMs: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.step, step);
    assert.match(result.detail, detail);
    assert.ok(!result.detail.includes("secret-key-value"));
  }
});
