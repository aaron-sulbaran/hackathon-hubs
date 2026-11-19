#!/usr/bin/env node
// ./hub setup: everything on the hub owner's checklist in one command. Safe to
// run again: each step checks what is already true and does only the rest.
// Node built-ins only, Node 20.9 or newer.
import { chmodSync, existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { CONFIG_FILE, defaultConfig, isTimeZone, loadConfig, parseConfig } from "../lib/hub/config.mjs";
import { SETUP_AGENT } from "../lib/hub/schema.mjs";
import { PROMPT_FILE, PROMPT_TEMPLATE_FILE, renderAgentPrompt } from "../lib/hub/agent-prompt.mjs";
import {
  IGNORED_BY_SETUP,
  ONBOARDING_TITLE,
  ONBOARDING_WHY,
  OWNER_LINK_FILE,
  STATE_FILE,
  VERCEL_IGNORED,
  buildPeople,
  mergePeople,
  isSampleEvent,
  parseDeployOutput,
  parseJsonOutput,
  parseVercelWhoami,
  vercelFailure,
  buildPlan,
  checkTeam,
  collectAliases,
  commitEmailFor,
  envNamesFrom,
  generateHubKey,
  isGithubLogin,
  looksLikeSampleTeam,
  machineTimeZone,
  parseLocalTime,
  parsePersonSpec,
  pickBoardUrl,
  renderPlan,
  repoFromRemote,
  slugify,
  tokenExpiryDays,
  teamMessageLines,
  tokenPageUrl,
  shouldPrintLink,
  unlockLink,
  withIgnoreLines,
} from "./setup/pure.mjs";
import { verifyBoard } from "./setup/verify.mjs";
import { createAsker, lastLine, listJsonFiles, readJsonFile, readText, run, writeIfChanged, writeJsonIfChanged } from "./setup/io.mjs";

const TEAM_FILE = "team.json";
const HUB_CLI = join("scripts", "hub.mjs");
const SECRET_ENV = ["HUB_TOKEN", "HUB_READ_TOKEN", "HUB_WRITE_TOKEN", "HUB_KEY"];

const HELP = `./hub setup [options]

Sets up this hub: event, team, onboarding prompt, private GitHub repo, invites,
the board on Vercel, and the message for your team. Run it again any time; it
picks up where it stopped and never redoes finished work.

  --yes                    never ask; for coding agents. Needs --name and --person while the
                           event and team are still the samples, and never takes over an existing
                           Vercel project or repo that no flag names. Keeps the unlock link out
                           of the output and writes it to ${OWNER_LINK_FILE} instead (gitignored,
                           readable only by you), so it never lands in an agent's transcript.
                           Sets the board token when HUB_TOKEN is in the environment.
  --dry-run                print the plan and change nothing
  --edit                   ask the event and team questions again

Event
  --name "<event name>"    --slug <slug>           --timezone <Area/City>
  --starts "2027-01-16 10:00"                      --submit-by "2027-01-17 09:00"
  --location "<where>"     --event-url <url>
Team
  --person "name=Ada Lovelace;github=ada-l;focus=Frontend;id=ada"   (repeat per person)
                           adds or updates people by id, GitHub username, or name; the sample
                           people are replaced, a real team is only added to
  --replace-team           make the --person list the whole team
  --owner <id>             the person who owns the hub (default: the first person)
GitHub
  --github-owner <login or org>   --repo-name <name>   (default: <slug>-hub)
  --repo <owner/name>      use a repo that already exists instead of creating one
  --skip-github            do the GitHub part by hand
Board (Vercel)
  --vercel-scope <team>    the Vercel team to use (default: the CLI's current team)
  --vercel-project <name>  default <slug>-hub; naming an existing project reuses it on purpose
  --board-url <https://...>  the address teammates open, if setup picks the wrong one
  --save-link              on a terminal, also save the unlock link in ${OWNER_LINK_FILE}
                           (gitignored). When the output is not a terminal, or with --yes, the
                           link is only saved there, never printed
  --print-link             print the unlock link even with --yes or into a pipe or log
  --new-key                make a new unlock link; everyone has to open the new one
  --deploy                 redeploy the board and check it (pushing never deploys). On a hub
                           already set up, and with no event, team, or repo flag, that is all
                           it does; otherwise every step runs first
  --skip-vercel            do the Vercel part by hand
Live mode
  --tokens                 only set the board's GitHub token: asks for it, or with
                           --yes reads HUB_TOKEN from the environment
  --separate-tokens        a read-only token and a write token instead of one
                           (with --yes: HUB_READ_TOKEN and HUB_WRITE_TOKEN)
  --skip-tokens            do not offer live mode this run

Exit codes: 0 done (some steps may be by hand), 1 stopped on a problem,
2 everything ran but the board check from outside failed.
`;

const OPTIONS = {
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  edit: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  name: { type: "string" },
  slug: { type: "string" },
  timezone: { type: "string" },
  starts: { type: "string" },
  "submit-by": { type: "string" },
  location: { type: "string" },
  "event-url": { type: "string" },
  person: { type: "string", multiple: true },
  owner: { type: "string" },
  "replace-team": { type: "boolean" },
  "github-owner": { type: "string" },
  "repo-name": { type: "string" },
  repo: { type: "string" },
  "skip-github": { type: "boolean" },
  "vercel-scope": { type: "string" },
  "vercel-project": { type: "string" },
  "board-url": { type: "string" },
  "save-link": { type: "boolean" },
  "print-link": { type: "boolean" },
  "new-key": { type: "boolean" },
  "skip-vercel": { type: "boolean" },
  deploy: { type: "boolean" },
  tokens: { type: "boolean" },
  "separate-tokens": { type: "boolean" },
  "skip-tokens": { type: "boolean" },
};

class SetupError extends Error {}

function say(text = "") {
  process.stdout.write(`${text}\n`);
}

function heading(number, title) {
  say(`\n[${number}/9] ${title}`);
}

// Children never inherit the token variables setup may have been handed.
function sh(ctx, command, args, options = {}) {
  const merged = { ...process.env, ...(options.env ?? {}) };
  for (const name of SECRET_ENV) delete merged[name];
  const env = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
  return run(command, args, { ...options, cwd: ctx.hubDir, env, replaceEnv: true });
}

// ---------- reading the hub ----------

function readState(hubDir) {
  return readJsonFile(join(hubDir, STATE_FILE)).data ?? {};
}

function readConfig(hubDir) {
  if (!existsSync(join(hubDir, CONFIG_FILE))) return defaultConfig();
  const loaded = loadConfig(hubDir);
  if (loaded.error) throw new SetupError(`${loaded.error}\nFix the file by hand, or delete it to start over.`);
  return loaded.data;
}

function readTeam(hubDir) {
  if (!existsSync(join(hubDir, TEAM_FILE))) return { people: [] };
  const loaded = readJsonFile(join(hubDir, TEAM_FILE));
  if (loaded.error) throw new SetupError(loaded.error);
  return loaded.data;
}

function onboardingOwners(hubDir) {
  const owners = new Set();
  for (const file of listJsonFiles(join(hubDir, "events"))) {
    const event = readJsonFile(file).data;
    if (event?.type === "item.add" && event.data?.area === "onboarding" && event.data?.owner) owners.add(event.data.owner);
  }
  return owners;
}

// ---------- step 1: preflight ----------

function preflight(ctx) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const facts = {
    nodeVersion: process.versions.node,
    nodeOk: major > 20 || (major === 20 && minor >= 9),
    gitOk: sh(ctx, "git", ["--version"]).ok,
    gitName: sh(ctx, "git", ["config", "user.name"]).out,
    gitEmail: sh(ctx, "git", ["config", "user.email"]).out,
    gh: { installed: false, loggedIn: false, login: "" },
    vercel: { installed: false, loggedIn: false, username: "", scope: "" },
  };
  if (!ctx.opts["skip-github"]) {
    facts.gh.installed = sh(ctx, "gh", ["--version"]).ok;
    if (facts.gh.installed) {
      // `gh auth status` exits 1 when any stored account anywhere has a problem,
      // so a working API call is the test of being logged in.
      const user = sh(ctx, "gh", ["api", "user", "--jq", ".login"]);
      facts.gh.loggedIn = user.ok && isGithubLogin(user.out);
      facts.gh.login = facts.gh.loggedIn ? user.out : "";
    }
  }
  if (!ctx.opts["skip-vercel"]) {
    facts.vercel.installed = sh(ctx, "vercel", ["--version"]).ok;
    if (facts.vercel.installed) {
      const scopeFlag = ctx.opts["vercel-scope"] ? ["--scope", ctx.opts["vercel-scope"]] : [];
      const who = parseVercelWhoami(sh(ctx, "vercel", ["whoami", "--json", ...scopeFlag]));
      facts.vercel.loggedIn = who.loggedIn;
      facts.vercel.username = who.username;
      // One scope for every Vercel call: the flag, then the scope this hub used before, then the CLI's current team.
      facts.vercel.scope = ctx.opts["vercel-scope"] || ctx.state.vercelScope || who.teamSlug || who.username;
    }
  }
  return facts;
}

function reportPreflight(ctx, facts) {
  heading(1, "Check the tools");
  say(`  node ${facts.nodeVersion}: ${facts.nodeOk ? "ok" : "too old"}`);
  say(`  git: ${facts.gitOk ? "ok" : "missing"}`);
  if (facts.gitOk) {
    // The address stays out of the output, which may land in a coding agent's transcript.
    if (facts.gitName && facts.gitEmail) say(`  git identity: ${facts.gitName}, email set`);
    else {
      // Setup signs its own commits, but ./hub doctor and every later commit need these.
      say("  git identity: not set. Set it once on this machine (use your GitHub no-reply address if you like):");
      if (!facts.gitName) say('    git config --global user.name "Your Name"');
      if (!facts.gitEmail) say('    git config --global user.email "you@example.com"');
    }
  }
  if (ctx.opts["skip-github"]) say("  gh: skipped (--skip-github)");
  else say(`  gh: ${facts.gh.installed ? (facts.gh.loggedIn ? `logged in; GitHub account ${facts.gh.login}` : "installed, not logged in") : "not installed"}`);
  if (ctx.opts["skip-vercel"]) say("  vercel: skipped (--skip-vercel)");
  else say(`  vercel: ${facts.vercel.installed ? (facts.vercel.loggedIn ? `logged in; Vercel account ${facts.vercel.username || "?"}, scope ${facts.vercel.scope || "?"}` : "installed, not logged in") : "not installed"}`);
  if (facts.gh.loggedIn || facts.vercel.loggedIn) {
    say("  Setup creates the repo and the Vercel project in the accounts above. Wrong one? Stop now (Ctrl+C) and pass");
    say("  --github-owner <login or org> or --vercel-scope <team>.");
  }
  if (!facts.nodeOk) throw new SetupError("The hub needs Node 20.9 or newer. Install the current LTS (brew install node, or nvm install 22), then run ./hub setup again.");
  if (!facts.gitOk) throw new SetupError("git is missing. Install it (xcode-select --install on a Mac), then run ./hub setup again.");
  const manual = [];
  if (!ctx.opts["skip-github"] && !facts.gh.loggedIn) {
    manual.push(`GitHub lookups, the repo, and invites (${facts.gh.installed ? "run gh auth login" : "install gh: brew install gh, then gh auth login"} to let setup do them)`);
  }
  if (!ctx.opts["skip-vercel"] && !facts.vercel.loggedIn) {
    manual.push(`the board on Vercel (${facts.vercel.installed ? "run vercel login" : "install the Vercel CLI: npm i -g vercel, then vercel login"} to let setup do it)`);
  }
  if (manual.length) {
    say("  These steps will be by hand; setup prints them when their turn comes:");
    for (const line of manual) say(`    - ${line}`);
  }
}

// ---------- step 2: event ----------

function eventFlagsGiven(opts) {
  return ["name", "slug", "timezone", "starts", "submit-by", "location", "event-url"].some((key) => opts[key] !== undefined);
}

// --deploy skips straight to the board only on a hub setup already finished and
// only when no event, team, or repo flag asks for more. Otherwise a first run
// with --deploy would put the sample hub on Vercel and never create the repo.
function deployOnly(opts, state) {
  if (!opts.deploy) return false;
  const finished = Boolean(state.eventConfirmed && state.teamConfirmed && state.boardUrl);
  const setupFlags = eventFlagsGiven(opts) || Boolean(opts.person?.length) || ["owner", "replace-team", "repo", "repo-name", "github-owner", "edit"].some((key) => opts[key] !== undefined);
  return finished && !setupFlags;
}

async function askUntilValid(ctx, question, fallback, check) {
  for (;;) {
    const answer = await ctx.asker.ask(question, fallback);
    const result = check(answer);
    if (!result.error) return result.data;
    say(`  ${result.error}`);
    if (ctx.asker.ended) throw new SetupError("Input ended before every question had an answer. Run ./hub setup in a terminal, or pass --yes with flags.");
  }
}

async function resolveEvent(ctx, interactive) {
  const { opts, state } = ctx;
  const current = ctx.config.event;
  const confirmed = Boolean(state.eventConfirmed);
  if (confirmed && !eventFlagsGiven(opts) && !opts.edit) return { event: current, changed: false };
  const ask = interactive && !opts.yes;

  let name = opts.name ?? current.name;
  if (ask && opts.name === undefined) name = await askUntilValid(ctx, "  Event name", current.name, (value) => (value.trim() ? { data: value.trim(), error: null } : { data: null, error: "The event needs a name." }));

  const customSlug = current.slug !== slugify(current.name);
  const slugDefault = customSlug ? current.slug : slugify(name);
  let slug = opts.slug ?? slugDefault;
  if (ask && opts.slug === undefined) slug = await askUntilValid(ctx, "  Short name for folders and the repo", slugDefault, (value) => (value === slugify(value) ? { data: value, error: null } : { data: null, error: `Use lowercase letters, digits, and dashes, like ${slugify(value)}.` }));
  if (slug !== slugify(slug)) throw new SetupError(`--slug "${slug}" must be lowercase letters, digits, and dashes, like ${slugify(slug)}.`);

  const zoneDefault = confirmed ? current.timezone : machineTimeZone();
  let timezone = opts.timezone ?? zoneDefault;
  if (ask && opts.timezone === undefined) timezone = await askUntilValid(ctx, "  Time zone of the event", zoneDefault, (value) => (isTimeZone(value) ? { data: value, error: null } : { data: null, error: `"${value}" is not a time zone this machine knows. Try America/New_York or Europe/Berlin.` }));
  if (!isTimeZone(timezone)) throw new SetupError(`--timezone "${timezone}" is not a time zone this machine knows.`);

  const times = {};
  for (const [key, flag, label] of [["startsAt", "starts", "  Hacking starts (like 2027-01-16 10:00, blank if unknown)"], ["submitBy", "submit-by", "  Submission deadline (like 2027-01-17 09:00, blank if unknown)"]]) {
    if (opts[flag] !== undefined) {
      const parsed = parseLocalTime(opts[flag], timezone);
      if (parsed.error) throw new SetupError(`--${flag}: ${parsed.error}`);
      times[key] = parsed.data;
    } else if (ask) {
      times[key] = await askUntilValid(ctx, label, current[key], (value) => parseLocalTime(value, timezone));
    } else times[key] = current[key];
  }

  let location = opts.location ?? current.location;
  if (ask && opts.location === undefined) location = await ctx.asker.ask("  Where (blank to skip)", current.location);
  const url = opts["event-url"] ?? current.url;

  const event = { ...current, name, slug, timezone, ...times, location, url };
  if (opts.yes && opts.name === undefined && opts.slug === undefined && isSampleEvent(event)) {
    throw new SetupError('hub.config.json still names the sample event. With --yes, pass --name "<your event>" (and --timezone, --starts, --submit-by).');
  }
  const parsed = parseConfig({ ...ctx.config, event });
  if (parsed.error) throw new SetupError(`hub.config.json would be invalid: ${parsed.error}`);
  return { event: parsed.data.event, changed: JSON.stringify(event) !== JSON.stringify(current) || !confirmed };
}

async function stepEvent(ctx) {
  heading(2, "Event details");
  const { event } = await resolveEvent(ctx, true);
  ctx.config = { ...ctx.config, event };
  const wrote = writeJsonIfChanged(join(ctx.hubDir, CONFIG_FILE), ctx.config);
  ctx.state.eventConfirmed = true;
  say(`  ${event.name} (${event.slug}), ${event.timezone}`);
  say(`  starts ${event.startsAt || "not set"}, submissions due ${event.submitBy || "not set"}`);
  say(wrote ? `  Wrote ${CONFIG_FILE}.` : `  ${CONFIG_FILE} already says this.`);
}

// ---------- step 3: team ----------

async function askPeople(ctx) {
  say("  Add each person, you first. Leave the name blank when everyone is in.");
  const entries = [];
  const taken = [];
  for (;;) {
    const name = await ctx.asker.ask(`  Person ${entries.length + 1} name`, "");
    if (!name) {
      if (entries.length) break;
      say("  The team needs at least one person.");
      if (ctx.asker.ended) throw new SetupError("Input ended before anyone was added to the team.");
      continue;
    }
    const suggested = buildPeople([...entries, { name }]).data?.at(-1)?.id ?? "";
    const id = await ctx.asker.ask("    id (short, lowercase)", suggested);
    const focus = await ctx.asker.ask("    focus (blank to skip)", "");
    const github = await ctx.asker.ask("    GitHub username (blank if unknown)", "");
    const check = buildPeople([...entries, { name, id, focus, github }]);
    if (check.error) {
      say(`  ${check.error} Try that person again.`);
      continue;
    }
    entries.push({ name, id, focus, github });
    taken.push(id);
  }
  return entries;
}

async function resolveTeam(ctx, interactive) {
  const { opts, state, team } = ctx;
  const ask = interactive && !opts.yes;
  let people = team.people ?? [];
  let changed = false;
  if (opts.person?.length) {
    const entries = [];
    for (const spec of opts.person) {
      const parsed = parsePersonSpec(spec);
      if (parsed.error) throw new SetupError(parsed.error);
      entries.push(parsed.data);
    }
    // The shipped sample people are replaced; a real team is added to, so a late teammate never removes the others.
    const replace = opts["replace-team"] || people.length === 0 || looksLikeSampleTeam(team);
    const built = buildPeople(replace ? entries : mergePeople(people, entries), people);
    if (built.error) throw new SetupError(built.error);
    changed = JSON.stringify(built.data) !== JSON.stringify(people);
    people = built.data;
  } else if (ask && (!state.teamConfirmed || opts.edit)) {
    if (people.length) {
      say("  team.json has:");
      for (const person of people) say(`    ${person.id}: ${person.name}${person.github ? ` (@${person.github})` : ""}`);
    }
    const keep = people.length > 0 && (await ctx.asker.confirm("  Keep these people?", !looksLikeSampleTeam(team)));
    if (!keep) {
      const built = buildPeople(await askPeople(ctx), people);
      if (built.error) throw new SetupError(built.error);
      people = built.data;
      changed = true;
    } else {
      for (const person of people) {
        if (person.github) continue;
        const login = (await ctx.asker.ask(`  GitHub username for ${person.name} (blank if unknown)`, "")).replace(/^@/, "");
        if (login && !isGithubLogin(login)) say(`  "${login}" is not a GitHub username; skipped.`);
        else if (login) {
          person.github = login;
          changed = true;
        }
      }
    }
  }
  const problem = checkTeam({ people });
  if (problem) throw new SetupError(`${problem} Pass --person for each teammate, or run ./hub setup without --yes.`);
  if (opts.yes && !opts.person?.length && looksLikeSampleTeam({ people })) {
    throw new SetupError('team.json still holds the sample people (Ada, Grace, Linus Example). With --yes, pass --person "name=...;github=..." once per teammate, you first.');
  }

  const ids = people.map((person) => person.id);
  let owner = opts.owner ?? (ids.includes(ctx.config.hub.owner) ? ctx.config.hub.owner : ids[0]);
  if (!ids.includes(owner)) throw new SetupError(`--owner "${owner}" is not on the team (${ids.join(", ")}).`);
  return { people, owner, changed: changed || owner !== ctx.config.hub.owner || !state.teamConfirmed };
}

function fillGithubFacts(ctx, people, owner, { lookUp }) {
  const lookups = [];
  const ownerPerson = people.find((person) => person.id === owner);
  if (ownerPerson && !ownerPerson.github && ctx.facts.gh.login) {
    ownerPerson.github = ctx.facts.gh.login;
    say(`  ${ownerPerson.name} is the owner; using your GitHub login ${ctx.facts.gh.login}.`);
  }
  for (const person of people) {
    if (!person.github || (person.githubId !== null && person.githubId !== undefined && person.commitEmail)) continue;
    // team.json is editable by any teammate; a login goes into an API path only if it looks like one.
    if (!isGithubLogin(person.github)) {
      say(`  "${person.github}" (${person.id}) is not a GitHub username; fix it in team.json.`);
      continue;
    }
    lookups.push(person.github);
    if (!lookUp) continue;
    if (person.githubId === null || person.githubId === undefined) {
      const found = sh(ctx, "gh", ["api", `users/${person.github}`, "--jq", ".id"]);
      const id = Number(found.out);
      if (!found.ok || !Number.isInteger(id)) {
        say(`  Could not find GitHub user ${person.github}; check the spelling and run setup again.`);
        continue;
      }
      person.githubId = id;
    }
    if (!person.commitEmail) person.commitEmail = commitEmailFor(person.githubId, person.github);
  }
  return lookups;
}

async function stepTeam(ctx) {
  heading(3, "Team");
  const { people, owner } = await resolveTeam(ctx, true);
  if (ctx.facts.gh.loggedIn) fillGithubFacts(ctx, people, owner, { lookUp: true });
  else if (people.some((person) => person.github && !person.githubId)) {
    say("  By hand, since gh is not logged in: for each person, `gh api users/<username> --jq .id` (or https://api.github.com/users/<username>)");
    say('  gives githubId; their commitEmail is "<githubId>+<username>@users.noreply.github.com". Put both in team.json.');
  }
  ctx.team = { ...ctx.team, people };
  ctx.config = { ...ctx.config, hub: { ...ctx.config.hub, owner } };
  const wroteTeam = writeJsonIfChanged(join(ctx.hubDir, TEAM_FILE), ctx.team);
  const wroteConfig = writeJsonIfChanged(join(ctx.hubDir, CONFIG_FILE), ctx.config);
  ctx.state.teamConfirmed = true;
  for (const person of people) {
    say(`  ${person.id}${person.id === owner ? " (owner)" : ""}: ${person.name}${person.github ? `, @${person.github}` : ", no GitHub username yet"}`);
  }
  say(wroteTeam || wroteConfig ? `  Wrote ${[wroteTeam && TEAM_FILE, wroteConfig && CONFIG_FILE].filter(Boolean).join(" and ")}.` : "  team.json already says this.");
}

// ---------- step 4: onboarding prompt ----------

function renderPrompt(ctx) {
  const templatePath = join(ctx.hubDir, PROMPT_TEMPLATE_FILE);
  const template = readText(templatePath);
  if (template === null) return { data: null, error: `${PROMPT_TEMPLATE_FILE} is missing.` };
  return renderAgentPrompt(ctx.config, ctx.team, template);
}

function stepPrompt(ctx, { quiet = false } = {}) {
  if (!quiet) heading(4, "Onboarding prompt");
  const rendered = renderPrompt(ctx);
  if (rendered.error) {
    say(`  Skipped: ${rendered.error}`);
    return false;
  }
  const wrote = writeIfChanged(join(ctx.hubDir, PROMPT_FILE), rendered.data);
  if (!quiet || wrote) say(wrote ? `  Wrote ${PROMPT_FILE}.` : `  ${PROMPT_FILE} is current.`);
  return wrote;
}

// ---------- step 5: onboarding tasks ----------

function stepSeed(ctx) {
  heading(5, "Onboarding tasks");
  if (!existsSync(join(ctx.hubDir, HUB_CLI))) {
    say(`  Skipped: ${HUB_CLI} is not in this folder, so there is no board to add tasks to yet.`);
    return;
  }
  const have = onboardingOwners(ctx.hubDir);
  const missing = ctx.team.people.filter((person) => !have.has(person.id));
  if (missing.length === 0) {
    say("  Every person already has one.");
    return;
  }
  for (const person of missing) {
    const added = sh(ctx, process.execPath, [HUB_CLI, "add", ONBOARDING_TITLE, "--why", ONBOARDING_WHY, "--owner", person.id, "--area", "onboarding", "--no-commit"], {
      env: { HUB_ME: ctx.config.hub.owner, HUB_AGENT: SETUP_AGENT, HUB_VIA: undefined },
    });
    if (!added.ok) throw new SetupError(`Could not add the onboarding task for ${person.id}: ${lastLine(added.err || added.out)}`);
    say(`  Added "${ONBOARDING_TITLE}" for ${person.id}.`);
  }
}

// ---------- step 6: git and GitHub ----------

function git(ctx, args, options) {
  return sh(ctx, "git", args, options);
}

// Local secrets and state stay out of git and out of what the Vercel CLI uploads.
function ensureIgnored(ctx, names = IGNORED_BY_SETUP) {
  const gitignore = join(ctx.hubDir, ".gitignore");
  const forGit = withIgnoreLines(readText(gitignore) ?? "", names);
  if (forGit.added.length) {
    writeIfChanged(gitignore, forGit.text);
    say(`  Added ${forGit.added.join(", ")} to .gitignore.`);
  }
  const vercelignore = join(ctx.hubDir, ".vercelignore");
  const forVercel = withIgnoreLines(readText(vercelignore) ?? "", VERCEL_IGNORED);
  if (forVercel.added.length) writeIfChanged(vercelignore, forVercel.text);
}

function commitIdentity(ctx) {
  const owner = ctx.team.people.find((person) => person.id === ctx.config.hub.owner);
  if (owner?.commitEmail) return ["-c", `user.name=${owner.name}`, "-c", `user.email=${owner.commitEmail}`];
  const args = [];
  if (!git(ctx, ["config", "user.email"]).ok) args.push("-c", `user.email=${ctx.config.hub.owner || "owner"}@hub.invalid`);
  if (!git(ctx, ["config", "user.name"]).ok) args.push("-c", `user.name=${owner?.name || "Hub owner"}`);
  return args;
}

const SETUP_PATHS = [CONFIG_FILE, TEAM_FILE, PROMPT_FILE, ".gitignore", ".vercelignore", "events"];

function commitSetupFiles(ctx, message) {
  const hasHead = git(ctx, ["rev-parse", "--verify", "-q", "HEAD"]).ok;
  if (hasHead) {
    const present = SETUP_PATHS.filter((path) => existsSync(join(ctx.hubDir, path)));
    git(ctx, ["add", "--", ...present]);
  } else {
    git(ctx, ["add", "-A"]);
    // Git on Windows records new files as 644; teammates on macOS and Linux need ./hub executable.
    const executables = ["hub", "scripts/hub.mjs", "scripts/setup.mjs"].filter((path) => existsSync(join(ctx.hubDir, path)));
    for (const path of executables) {
      try {
        chmodSync(join(ctx.hubDir, path), 0o755);
      } catch {
        // Windows has no executable bit on disk; the index entry below is what teammates get.
      }
    }
    if (executables.length) git(ctx, ["update-index", "--chmod=+x", "--", ...executables]);
  }
  if (git(ctx, ["diff", "--cached", "--quiet"]).ok) return false;
  const committed = git(ctx, [...commitIdentity(ctx), "commit", "-q", "--no-verify", "-m", message]);
  if (!committed.ok) throw new SetupError(`git commit failed: ${lastLine(committed.err || committed.out)}`);
  say(`  Committed: ${message}`);
  return true;
}

function currentBranch(ctx) {
  return git(ctx, ["symbolic-ref", "--short", "HEAD"]).out || "main";
}

// Teammates push events all day, so a rerun first takes their commits, then pushes.
function pushIfAhead(ctx) {
  const branch = currentBranch(ctx);
  const fetched = git(ctx, ["fetch", "-q", "origin", branch]);
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remoteExists = fetched.ok && git(ctx, ["rev-parse", "--verify", "-q", remoteRef]).ok;
  if (remoteExists) {
    const behind = Number(git(ctx, ["rev-list", "--count", `HEAD..${remoteRef}`]).out) || 0;
    if (behind > 0) {
      const rebased = git(ctx, [...commitIdentity(ctx), "rebase", "-q", "--autostash", remoteRef]);
      if (!rebased.ok) {
        git(ctx, ["rebase", "--abort"]);
        say(`  Could not rebase on origin/${branch}: ${lastLine(rebased.err)}. Run: git pull --rebase && git push`);
        return;
      }
    }
    const ahead = Number(git(ctx, ["rev-list", "--count", `${remoteRef}..HEAD`]).out) || 0;
    if (ahead === 0) {
      say(`  ${branch} is pushed; origin has every commit.`);
      return;
    }
  }
  const pushed = git(ctx, ["push", "-q", "-u", "origin", `HEAD:refs/heads/${branch}`]);
  say(pushed.ok ? `  Pushed ${branch}.` : `  Push failed: ${lastLine(pushed.err)}. Run: git pull --rebase && git push, then setup again.`);
}

function printManualRepo(ctx, repoName) {
  say("  By hand (gh is not logged in, or --skip-github):");
  say(`    1. Create a PRIVATE repo named ${repoName} at https://github.com/new (no README, no .gitignore).`);
  say("    2. In this folder:");
  say(`       git remote add origin https://github.com/<you>/${repoName}.git && git push -u origin ${currentBranch(ctx)}`);
  say("    3. Run ./hub setup again; it records the repo and sends the invites (or invite each teammate at");
  say("       https://github.com/<you>/" + repoName + "/settings/access with write access).");
}

function invite(ctx) {
  const repo = ctx.config.hub.repo;
  const ownerLogin = (ctx.facts.gh.login || "").toLowerCase();
  // The owner owns the repo; GitHub refuses an invite to yourself.
  const teammates = ctx.team.people.filter((person) => person.id !== ctx.config.hub.owner);
  const people = teammates.filter((person) => person.github && person.github.toLowerCase() !== ownerLogin && isGithubLogin(person.github));
  const noLogin = teammates.filter((person) => !person.github).map((person) => person.id);
  const badLogin = teammates.filter((person) => person.github && !isGithubLogin(person.github)).map((person) => person.id);
  if (noLogin.length) say(`  No GitHub username yet for ${noLogin.join(", ")}; add it with --person or in team.json, then run setup again.`);
  if (badLogin.length) say(`  Not a GitHub username in team.json for ${badLogin.join(", ")}; fix it, then run setup again.`);
  if (!people.length) return;
  if (!ctx.facts.gh.loggedIn) {
    say(`  Invite by hand at https://github.com/${repo}/settings/access with write access: ${people.map((person) => person.github).join(", ")}`);
    return;
  }
  const pending = sh(ctx, "gh", ["api", `repos/${repo}/invitations`, "--jq", ".[].invitee.login"]);
  const invited = new Set(pending.ok ? pending.out.split("\n").map((login) => login.trim().toLowerCase()).filter(Boolean) : []);
  for (const person of people) {
    const login = person.github;
    if (invited.has(login.toLowerCase())) {
      say(`  ${login}: invited, not accepted yet.`);
      ctx.inviteOutstanding = true;
      continue;
    }
    if (sh(ctx, "gh", ["api", `repos/${repo}/collaborators/${login}`, "--silent"]).ok) {
      say(`  ${login}: already has access.`);
      continue;
    }
    const sent = sh(ctx, "gh", ["api", "-X", "PUT", `repos/${repo}/collaborators/${login}`, "-f", "permission=push", "--silent"]);
    if (sent.ok) ctx.inviteOutstanding = true;
    say(sent.ok ? `  ${login}: invited with write access.` : `  ${login}: invite failed (${lastLine(sent.err)}).`);
  }
}

function stepGithub(ctx) {
  heading(6, "Git and GitHub");
  if (!existsSync(join(ctx.hubDir, ".git"))) {
    const init = git(ctx, ["init", "-q", "-b", "main"]);
    if (!init.ok) throw new SetupError(`git init failed: ${lastLine(init.err)}`);
    say("  Started a git repo (branch main).");
  }
  ensureIgnored(ctx);
  commitSetupFiles(ctx, `Set up the hub for ${ctx.config.event.name}`);

  let origin = git(ctx, ["remote", "get-url", "origin"]);
  const originRepo = origin.ok ? repoFromRemote(origin.out) : "";
  if (ctx.opts.repo && originRepo && originRepo.toLowerCase() !== ctx.opts.repo.toLowerCase()) {
    throw new SetupError(`--repo ${ctx.opts.repo} does not match origin (${originRepo}). Fix origin first: git remote set-url origin https://github.com/${ctx.opts.repo}.git`);
  }
  if (!origin.ok && ctx.opts.repo) {
    git(ctx, ["remote", "add", "origin", `https://github.com/${ctx.opts.repo}.git`]);
    origin = git(ctx, ["remote", "get-url", "origin"]);
    say(`  Added origin https://github.com/${ctx.opts.repo}.git`);
  }
  if (!origin.ok) {
    const repoName = ctx.opts["repo-name"] ?? `${ctx.config.event.slug}-hub`;
    if (ctx.opts["skip-github"] || !ctx.facts.gh.loggedIn) {
      printManualRepo(ctx, repoName);
      return;
    }
    const repoOwner = ctx.opts["github-owner"] ?? ctx.facts.gh.login;
    const fullName = `${repoOwner}/${repoName}`;
    const created = sh(ctx, "gh", ["repo", "create", fullName, "--private", "--source", ".", "--push"]);
    if (!created.ok) throw new SetupError(`gh repo create ${fullName} failed: ${lastLine(created.err)}`);
    say(`  Created the private repo ${fullName} and pushed.`);
    ctx.createdRepo = fullName;
    origin = git(ctx, ["remote", "get-url", "origin"]);
  }

  const repo = ctx.opts.repo ?? (repoFromRemote(origin.out) || ctx.createdRepo || ctx.config.hub.repo);
  if (repo && repo !== ctx.config.hub.repo) {
    ctx.config = { ...ctx.config, hub: { ...ctx.config.hub, repo } };
    const parsed = parseConfig(ctx.config);
    if (parsed.error) throw new SetupError(`hub.repo "${repo}": ${parsed.error}`);
    writeJsonIfChanged(join(ctx.hubDir, CONFIG_FILE), ctx.config);
    say(`  Recorded hub.repo = ${repo}.`);
    stepPrompt(ctx, { quiet: true });
    commitSetupFiles(ctx, `Record the hub repo ${repo}`);
  }
  if (origin.ok) pushIfAhead(ctx);
  if (ctx.config.hub.repo) invite(ctx);
}

// ---------- step 7: board ----------

// Every Vercel call names the same scope, so create, link, env, and deploy cannot drift apart.
function vercel(ctx, args, { noScope = false, ...options } = {}) {
  const scope = ctx.facts.vercel.scope;
  return sh(ctx, "vercel", [...args, ...(scope && !noScope ? ["--scope", scope] : [])], options);
}

function vercelReady(ctx) {
  return !ctx.opts["skip-vercel"] && ctx.facts.vercel.installed && ctx.facts.vercel.loggedIn;
}

function printManualBoard(ctx) {
  say("  By hand:");
  say("    1. Install and log in: npm i -g vercel && vercel login");
  say("    2. Run ./hub setup again. It links the project, sets HUB_KEY and HUB_REPO, deploys, and gives you the unlock link.");
  say("    Without the CLI: import the repo at https://vercel.com/new, add HUB_REPO (owner/name) and HUB_KEY");
  say("    (make one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\")");
  say(`    as Production variables, deploy, and open <board url>${ctx.config.hub.basePath}/unlock?key=<HUB_KEY>.`);
}

function productionEnvNames(ctx) {
  const listed = vercel(ctx, ["env", "list", "--environment", "production", "--json"]);
  if (!listed.ok) return null;
  try {
    return envNamesFrom(JSON.parse(listed.out));
  } catch {
    return null;
  }
}

function setEnv(ctx, name, value, { sensitive }) {
  const added = vercel(ctx, ["env", "add", name, "--environment", "production", sensitive ? "--sensitive" : "--no-sensitive", "--force", "--yes"], { input: value });
  if (!added.ok) throw new SetupError(`vercel env add ${name} failed: ${vercelFailure(added)}`);
  say(`  Set ${name} for production.`);
  // A variable reaches the board only with the next deploy; remembered in case that deploy fails.
  ctx.state.needsDeploy = true;
}

// Never takes over a Vercel project setup did not make, unless it was named on purpose.
function linkProject(ctx) {
  if (existsSync(join(ctx.hubDir, ".vercel", "project.json"))) return;
  const scope = ctx.facts.vercel.scope;
  const project = ctx.opts["vercel-project"] ?? ctx.state.vercelProject ?? `${ctx.config.event.slug}-hub`;
  if (vercel(ctx, ["project", "inspect", project]).ok) {
    const madeBySetup = ctx.state.vercelProject === project;
    if (!madeBySetup && ctx.opts["vercel-project"] !== project) {
      throw new SetupError(
        `A Vercel project named ${project} already exists in scope ${scope}. Setup does not take over a project it did not make.\n` +
          `Reuse it on purpose with --vercel-project ${project} (setup then makes a new unlock key), or pick another name with --vercel-project <name>.`,
      );
    }
    if (!madeBySetup) {
      // Old unlock links for that project must stop working.
      ctx.forceNewKey = true;
      say(`  Reusing the existing Vercel project ${project} (named with --vercel-project); it gets a new unlock key.`);
    }
  } else {
    say(`  Creating the Vercel project ${project} in scope ${scope}.`);
    const created = vercel(ctx, ["project", "create", project]);
    if (!created.ok) throw new SetupError(`vercel project create ${project} failed: ${vercelFailure(created)}`);
  }
  ctx.state.vercelProject = project;
  ctx.state.vercelScope = scope;
  // Without a TTY the CLI never picks a team on its own, so link names the scope it should use.
  const linked = vercel(ctx, ["link", "--yes", "--project", project, "--team", scope], { noScope: true });
  if (!linked.ok) throw new SetupError(`vercel link failed: ${vercelFailure(linked)}`);
  say(`  Linked this folder to the Vercel project ${project}.`);
}

function deploy(ctx) {
  say("  Deploying (a couple of minutes)...");
  // --json: the CLI writes JSON anyway when a coding agent runs it, so always ask for it and parse it.
  const deployed = vercel(ctx, ["deploy", "--prod", "--yes", "--json"]);
  if (!deployed.ok) throw new SetupError(`vercel deploy failed: ${vercelFailure(deployed)}`);
  const { url: deploymentUrl, productionUrl } = parseDeployOutput(deployed.out);
  // --board-url is remembered, so later redeploys keep the address the owner chose.
  if (ctx.opts["board-url"]) ctx.state.boardUrlOverride = ctx.opts["board-url"].replace(/\/+$/, "");
  let boardUrl = ctx.state.boardUrlOverride || productionUrl;
  if (!boardUrl && deploymentUrl) {
    const inspected = vercel(ctx, ["inspect", deploymentUrl, "--json"]);
    boardUrl = pickBoardUrl(inspected.ok ? collectAliases(parseJsonOutput(inspected.out) ?? {}) : [], deploymentUrl);
  }
  if (!boardUrl) throw new SetupError("Deployed, but could not read the board's address. Run setup again with --board-url <https://...>.");
  ctx.state.boardUrl = boardUrl;
  ctx.state.deployedAt = new Date().toISOString();
  delete ctx.state.needsDeploy;
  say(`  Live at ${boardUrl}${ctx.config.hub.basePath}`);
  return boardUrl;
}

// The owner file holds either the unlock link, or, between making a key and
// showing its link, the bare key. Either way the key is never lost to a failed step.
function ownerFile(ctx) {
  return join(ctx.hubDir, OWNER_LINK_FILE);
}

// The ignore rule's text is not enough: a later "!" pattern or a file that is
// already tracked means git would still commit it. So git itself is asked.
// Outside a git repo there is nothing to commit it to yet, and the rule waits.
function confirmOwnerFileIgnored(ctx) {
  if (!git(ctx, ["rev-parse", "--is-inside-work-tree"]).ok) return;
  const checked = git(ctx, ["check-ignore", "-q", "--", OWNER_LINK_FILE]);
  if (checked.ok) return;
  const tracked = git(ctx, ["ls-files", "--error-unmatch", "--", OWNER_LINK_FILE]).ok;
  const why = tracked
    ? `${OWNER_LINK_FILE} is tracked by git, so the ignore rule does not apply to it. Untrack it with git rm --cached ${OWNER_LINK_FILE}`
    : checked.status === 1
      ? `git does not ignore ${OWNER_LINK_FILE}, though .gitignore names it; a later "!" rule or another ignore file overrides it. Fix that`
      : `git could not say whether ${OWNER_LINK_FILE} is ignored (${lastLine(checked.err) || `exit ${checked.status}`}). Fix that`;
  throw new SetupError(`Refusing to write the unlock key or link to ${OWNER_LINK_FILE}: ${why}, then run ./hub setup again.`);
}

function writeOwnerFile(ctx, text) {
  ensureIgnored(ctx, [OWNER_LINK_FILE]);
  confirmOwnerFileIgnored(ctx);
  writeIfChanged(ownerFile(ctx), text, { mode: 0o600 });
}

function pendingKey(ctx) {
  const match = /^HUB_KEY=(\S+)$/m.exec(readText(ownerFile(ctx)) ?? "");
  return match ? match[1] : null;
}

// The key inside a saved link, so a later run can still check the board.
function savedKey(ctx) {
  const match = /[?&]key=([^&\s]+)/.exec(readText(ownerFile(ctx)) ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

async function checkBoard(ctx, boardUrl, key) {
  say("  Checking the board from outside: unlock link, then the home page...");
  const result = await verifyBoard(boardUrl, ctx.config.hub.basePath, key);
  if (result.ok) {
    say(`  Board check passed: ${result.detail}.`);
    return;
  }
  ctx.boardCheckFailed = true;
  say(`  Board check FAILED at the ${result.step}: ${result.detail}`);
  say("  The board is not usable yet. Fix that, then run ./hub setup --deploy to redeploy and check again.");
}

function showLink(ctx, boardUrl, key) {
  const link = unlockLink(boardUrl, ctx.config.hub.basePath, key);
  say("");
  if (!ctx.printLink) {
    // Output that is not a terminal ends up in logs and agent transcripts, so
    // the reusable link goes only to the private owner file.
    writeOwnerFile(ctx, `${link}\n`);
    say(`  Unlock link saved in ${OWNER_LINK_FILE} (gitignored, readable only by you). It is kept out of this`);
    say("  output on purpose: output that is not a terminal ends up in logs and agent transcripts. Open that file");
    say("  to copy it (anyone with it can open the board), or rerun with --print-link to print it.");
    say("  Send it to teammates only by private message. Never commit it or post it anywhere public.");
    ctx.state.keyShown = true;
    delete ctx.state.pendingKeySet;
    say("");
    return;
  }
  say("  Unlock link (shown once; anyone with it can open the board):");
  say(`  ${link}`);
  say("  Send it to teammates only by private message. Never commit it or post it anywhere public.");
  if (ctx.opts["save-link"]) {
    writeOwnerFile(ctx, `${link}\n`);
    say(`  Also saved in ${OWNER_LINK_FILE} (gitignored, readable only by you).`);
  } else {
    // Never leave an older link or the bare key behind.
    rmSync(ownerFile(ctx), { force: true });
    say(`  Lose it and you need a new one: ./hub setup --new-key. Add --save-link to keep a copy in ${OWNER_LINK_FILE}.`);
  }
  ctx.state.keyShown = true;
  delete ctx.state.pendingKeySet;
  say("");
}

async function stepBoard(ctx) {
  heading(7, "Board on Vercel");
  if (ctx.opts["skip-vercel"]) {
    say("  Skipped (--skip-vercel).");
    printManualBoard(ctx);
    return;
  }
  if (!vercelReady(ctx)) {
    printManualBoard(ctx);
    return;
  }
  linkProject(ctx);
  const names = productionEnvNames(ctx);
  const keyOnVercel = names ? names.includes("HUB_KEY") : Boolean(ctx.state.hubKeySet);
  let key = pendingKey(ctx);
  let changed = false;
  if (ctx.opts["new-key"] || ctx.forceNewKey || (!keyOnVercel && !key)) {
    key = generateHubKey();
    ctx.state.pendingKeySet = false;
    // Kept on disk before Vercel hears of it, so a failure further on cannot lose it.
    writeOwnerFile(ctx, `HUB_KEY=${key}\n# The unlock link for this key has not been shown yet. Run ./hub setup again to finish.\n`);
  }
  if (key && (!ctx.state.pendingKeySet || !keyOnVercel)) {
    setEnv(ctx, "HUB_KEY", key, { sensitive: true });
    ctx.state.hubKeySet = true;
    ctx.state.pendingKeySet = true;
    ctx.state.keyShown = false;
    changed = true;
  }
  try {
    const repo = ctx.config.hub.repo;
    const repoExists = names ? names.includes("HUB_REPO") : Boolean(ctx.state.hubRepo);
    if (repo && (!repoExists || ctx.state.hubRepo !== repo)) {
      setEnv(ctx, "HUB_REPO", repo, { sensitive: false });
      ctx.state.hubRepo = repo;
      changed = true;
    }
    const redeploy = changed || key || !ctx.state.boardUrl || Boolean(ctx.opts.deploy) || Boolean(ctx.state.needsDeploy);
    const boardUrl = redeploy ? deploy(ctx) : ctx.state.boardUrl;
    if (!redeploy) say(`  Already deployed at ${boardUrl}${ctx.config.hub.basePath}; nothing changed.`);
    if (key) {
      showLink(ctx, boardUrl, key);
      await checkBoard(ctx, boardUrl, key);
      return;
    }
    const saved = savedKey(ctx);
    if (ctx.opts["save-link"] && !saved) say("  --save-link: nothing to save, because setup does not know the current key. ./hub setup --new-key --save-link makes one and keeps it.");
    if (saved) {
      say(`  The unlock link is in ${OWNER_LINK_FILE}.`);
      if (redeploy) await checkBoard(ctx, boardUrl, saved);
    } else if (ctx.state.keyShown) {
      say("  The unlock link was shown when its key was made. Lost it? ./hub setup --new-key (everyone opens the new link).");
      if (redeploy) say("  Not checked from outside: without the link setup cannot open the board. --save-link keeps a copy for that.");
    } else {
      say("  This Vercel project has a HUB_KEY that setup never showed a link for. Run ./hub setup --new-key to make one you have.");
    }
  } catch (error) {
    if (error instanceof SetupError && key) {
      throw new SetupError(`${error.message}\nThe new unlock key is kept in ${OWNER_LINK_FILE} (readable only by you); running ./hub setup again finishes and gives you its link.`);
    }
    throw error;
  }
}

// ---------- step 8: live mode token ----------

// One token with Contents read and write serves both board calls (write
// includes read). --separate-tokens keeps a read-only token for the reads.
function tokenSettings(ctx) {
  const repo = ctx.config.hub.repo;
  const [owner, name] = repo.split("/");
  const days = tokenExpiryDays(ctx.config.event.submitBy);
  const pick = `Choose Only select repositories and pick ${repo}.`;
  const make = (label, contents, envNames, permission, purpose) => ({
    label,
    envNames,
    permission,
    url: tokenPageUrl({ name: `${name} board${label === "board" ? "" : ` ${label}`}`.slice(0, 40), description: `${purpose} ${pick}`, owner, contents, expiresInDays: days }),
  });
  if (ctx.opts["separate-tokens"]) {
    return [
      make("read", "read", ["HUB_READ_TOKEN"], "Contents: Read-only", "The hub board reads the repo with this."),
      make("write", "write", ["HUB_WRITE_TOKEN"], "Contents: Read and write", "The hub board saves new events with this."),
    ];
  }
  return [make("board", "write", ["HUB_READ_TOKEN", "HUB_WRITE_TOKEN"], "Contents: Read and write", "The hub board reads the repo and saves new events with this.")];
}

function tokenFromEnv(token) {
  if (token.envNames.length > 1) return process.env.HUB_TOKEN || "";
  return process.env[token.envNames[0]] || "";
}

async function stepTokens(ctx) {
  heading(8, "Live mode token");
  if (ctx.state.tokensSet && !ctx.opts.tokens) {
    say("  The board's GitHub token is set. To replace it: ./hub setup --tokens");
    return;
  }
  const settings = ctx.config.hub.repo ? tokenSettings(ctx) : [];
  const fromEnv = settings.length > 0 && settings.every((token) => tokenFromEnv(token));
  let want = ctx.opts.tokens || (ctx.opts.yes && fromEnv);
  if (!want && !ctx.opts.yes && !ctx.opts["skip-tokens"]) {
    say("  Without a token the board shows the files from its last deploy and cannot save anything.");
    say("  With one GitHub token (this repo only) it reads the repo live and saves what people post from the board.");
    want = await ctx.asker.confirm("  Set it up now? It takes about two minutes.", false);
  }
  if (!want) {
    say("  Skipped. Any time later: ./hub setup --tokens");
    return;
  }
  if (!ctx.config.hub.repo) {
    say("  Needs the GitHub repo first. Finish step 6, then ./hub setup --tokens");
    return;
  }
  if (!vercelReady(ctx)) {
    say("  Needs the Vercel CLI, logged in (npm i -g vercel && vercel login). Then ./hub setup --tokens");
    return;
  }
  // --yes never asks, so a missing token is an error that names its variable, checked before anything changes.
  if (ctx.opts.yes && !fromEnv) {
    const missing = settings.filter((token) => !tokenFromEnv(token)).map((token) => (token.envNames.length > 1 ? "HUB_TOKEN" : token.envNames[0]));
    throw new SetupError(`--tokens --yes reads the token from the environment, and ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. Export it, or run ./hub setup --tokens without --yes to paste it.`);
  }
  linkProject(ctx);
  const values = new Map();
  if (fromEnv && (ctx.opts.yes || !process.stdin.isTTY)) {
    for (const token of settings) values.set(token, tokenFromEnv(token));
    say("  Using the token from the environment.");
  } else {
    say("  GitHub fills in the name, expiry, and permission from the link. You set one thing on the page:");
    say(`    Repository access: Only select repositories, then pick ${ctx.config.hub.repo}`);
    say("  Then Generate token, and copy it.");
    for (const token of settings) {
      say(`\n  The ${token.label} token (${token.permission}, nothing else):`);
      say(`  ${token.url}`);
      let value = "";
      while (!value) {
        value = (await ctx.asker.secret(`  Paste the ${token.label} token (it stays hidden)`)).trim();
        if (value) break;
        if (ctx.asker.ended) throw new SetupError(`Input ended before the ${token.label} token was pasted. Run ./hub setup --tokens in a terminal, or export ${token.envNames.length > 1 ? "HUB_TOKEN" : token.envNames[0]} and add --yes.`);
        say("  Nothing pasted; try again, or press Ctrl+C and run ./hub setup --tokens later.");
      }
      values.set(token, value);
    }
  }
  for (const token of settings) {
    const value = values.get(token);
    if (!value) throw new SetupError(`The ${token.label} token is empty.`);
    if (!value.startsWith("github_pat_")) say(`  Note: the ${token.label} token does not look like a fine-grained token (github_pat_...).`);
    for (const envName of token.envNames) setEnv(ctx, envName, value, { sensitive: true });
  }
  ctx.state.tokensSet = true;
  const boardUrl = deploy(ctx);
  const key = savedKey(ctx);
  if (key) await checkBoard(ctx, boardUrl, key);
  say("  Live mode is on: the board reads the repo within about 30 seconds and saves posts to it.");
}

// ---------- step 9: message ----------

function stepMessage(ctx) {
  heading(9, "Message for the team");
  const repo = ctx.config.hub.repo || `<owner>/${ctx.config.event.slug}-hub`;
  const branch = existsSync(join(ctx.hubDir, ".git")) ? currentBranch(ctx) : "main";
  if (ctx.printLink) {
    say("  Paste this in your team chat. Put the unlock link where it says <UNLOCK_LINK> only if that chat is private;");
    say("  otherwise send the link to each person by private message.\n");
  } else {
    say(`  Paste this in your team chat. Where it says <UNLOCK_LINK>, paste the link from ${OWNER_LINK_FILE} only if`);
    say("  that chat is private; otherwise send the link to each person by private message.\n");
  }
  say("```text");
  for (const line of teamMessageLines({ repo, branch, inviteOutstanding: ctx.inviteOutstanding })) say(line);
  say("```");
  if (ctx.config.hub.repo) {
    // The onboarding prompt tells a cloud agent to wait for this token; only the owner can make it.
    const [owner, name] = ctx.config.hub.repo.split("/");
    const url = tokenPageUrl({
      name: `${name} cloud agent`.slice(0, 40),
      description: `Lets one teammate's cloud agent push to the hub. Choose Only select repositories and pick ${ctx.config.hub.repo}.`,
      owner,
      contents: "write",
      expiresInDays: tokenExpiryDays(ctx.config.event.submitBy),
    });
    say("\n  Teammates whose coding agent runs in the cloud (a browser agent, not their own computer) need a token from you,");
    say("  which they save as HUB_GIT_TOKEN. Make one per person with this link (choose Only select repositories, then the hub),");
    say("  and send it by private message:");
    say(`  ${url}`);
  }
  say("\n  Pushing to the repo never deploys the board; deploys go through the Vercel CLI only. After you change the");
  say("  board's code, run ./hub setup --deploy (or vercel deploy --prod). Events and kb pages need no deploy once");
  say("  the board's token is set.");
}

// ---------- plan and dry run ----------

// A step that would stop the real run shows up in the plan instead of ending the dry run.
async function orStop(work, fallback, stops) {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    stops.push(error.message);
    return fallback;
  }
}

async function gatherPlanFacts(ctx) {
  const stops = [];
  const { event, changed: eventChanges } = await orStop(() => resolveEvent(ctx, false), { event: ctx.config.event, changed: true }, stops);
  const config = { ...ctx.config, event };
  const fallbackPeople = ctx.team.people ?? [];
  const { people, owner, changed: teamChanges } = await orStop(() => resolveTeam(ctx, false), { people: fallbackPeople, owner: ctx.config.hub.owner || fallbackPeople[0]?.id || "", changed: true }, stops);
  const team = { ...ctx.team, people: people.map((person) => ({ ...person })) };
  config.hub = { ...config.hub, owner };
  const githubLookups = ctx.facts.gh.loggedIn ? people.filter((person) => person.github && !(person.githubId && person.commitEmail)).map((person) => person.github) : [];
  const rendered = renderAgentPrompt(config, team, readText(join(ctx.hubDir, PROMPT_TEMPLATE_FILE)) ?? undefined);
  const promptCurrent = !rendered.error && readText(join(ctx.hubDir, PROMPT_FILE)) === rendered.data;
  const gitRepo = existsSync(join(ctx.hubDir, ".git"));
  const origin = gitRepo ? git(ctx, ["remote", "get-url", "origin"]) : { ok: false, out: "" };
  const repo = ctx.opts.repo ?? (repoFromRemote(origin.out) || config.hub.repo);
  const onboarding = onboardingOwners(ctx.hubDir);
  const linked = existsSync(join(ctx.hubDir, ".vercel", "project.json"));
  const names = vercelReady(ctx) && linked ? productionEnvNames(ctx) : null;
  const ownerLogin = (ctx.facts.gh.login || "").toLowerCase();
  return {
    ...ctx.facts,
    eventConfirmed: Boolean(ctx.state.eventConfirmed),
    eventChanges: eventChanges && Boolean(ctx.state.eventConfirmed),
    eventName: event.name,
    teamConfirmed: Boolean(ctx.state.teamConfirmed),
    teamChanges: teamChanges && Boolean(ctx.state.teamConfirmed),
    teamIds: people.map((person) => person.id),
    githubLookups,
    promptCurrent,
    hubCliPresent: existsSync(join(ctx.hubDir, HUB_CLI)),
    onboardingMissing: people.filter((person) => !onboarding.has(person.id)).map((person) => person.id),
    gitRepo,
    uncommitted: !gitRepo || git(ctx, ["status", "--porcelain"]).out !== "",
    originExists: origin.ok,
    unpushed: false,
    plannedRepo: `${ctx.opts["github-owner"] ?? (ctx.facts.gh.login || "<you>")}/${ctx.opts["repo-name"] ?? `${event.slug}-hub`}`,
    repo,
    skipGithub: Boolean(ctx.opts["skip-github"]),
    invitesToSend: people.filter((person) => person.id !== owner && person.github && person.github.toLowerCase() !== ownerLogin).map((person) => person.github),
    vercelProject: ctx.opts["vercel-project"] ?? ctx.state.vercelProject ?? `${event.slug}-hub`,
    stops,
    skipVercel: Boolean(ctx.opts["skip-vercel"]),
    vercelLinked: linked,
    hubKeySet: names ? names.includes("HUB_KEY") : Boolean(ctx.state.hubKeySet),
    hubRepoSet: names ? names.includes("HUB_REPO") && ctx.state.hubRepo === repo : ctx.state.hubRepo === repo,
    newKey: Boolean(ctx.opts["new-key"]),
    printLink: ctx.printLink,
    forceDeploy: Boolean(ctx.opts.deploy),
    deployOnly: deployOnly(ctx.opts, ctx.state),
    deployed: Boolean(ctx.state.boardUrl),
    boardUrl: ctx.state.boardUrl ?? "",
    tokensSet: Boolean(ctx.state.tokensSet) && !ctx.opts.tokens,
    wantTokens: Boolean(ctx.opts.tokens || (ctx.opts.yes && (ctx.opts["separate-tokens"] ? process.env.HUB_READ_TOKEN && process.env.HUB_WRITE_TOKEN : process.env.HUB_TOKEN))),
  };
}

// ---------- main ----------

export async function main(argv, { hubDir = resolve(dirname(fileURLToPath(import.meta.url)), "..") } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false, strict: true });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`);
    return 1;
  }
  const opts = parsed.values;
  if (opts.help) {
    say(HELP);
    return 0;
  }
  const ctx = {
    hubDir,
    opts,
    state: readState(hubDir),
    asker: createAsker(),
    facts: null,
    config: null,
    team: null,
    createdRepo: "",
    boardCheckFailed: false,
    inviteOutstanding: false,
    printLink: shouldPrintLink({ stdoutIsTTY: process.stdout.isTTY, yes: opts.yes, printLink: opts["print-link"] }),
  };
  const startState = JSON.stringify(ctx.state);
  try {
    // Checked before anything runs, so a typo never reaches git remote add.
    if (opts.repo !== undefined && parseConfig({ hub: { repo: opts.repo } }).error) {
      throw new SetupError(`--repo "${opts.repo}" must be owner/name, like ada-gh/my-hub.`);
    }
    ctx.config = readConfig(hubDir);
    ctx.team = readTeam(hubDir);
    ctx.facts = preflight(ctx);

    if (opts["dry-run"]) {
      say("Dry run: nothing below has happened. Each line says what ./hub setup would do.\n");
      const facts = await gatherPlanFacts(ctx);
      say(renderPlan(buildPlan(facts)));
      if (facts.stops.length) say(`\nThe real run would stop:\n${facts.stops.map((message) => `  ${message}`).join("\n")}`);
      return 0;
    }

    reportPreflight(ctx, ctx.facts);
    const onlyDeploy = deployOnly(opts, ctx.state);
    // With --yes, a sample event or team stops the run here, before any file is written.
    if (opts.yes && !opts.tokens && !onlyDeploy) {
      await resolveEvent(ctx, false);
      await resolveTeam(ctx, false);
    }
    if (opts.tokens) {
      await stepTokens(ctx);
      return ctx.boardCheckFailed ? 2 : 0;
    }
    if (onlyDeploy) {
      await stepBoard(ctx);
      return ctx.boardCheckFailed ? 2 : 0;
    }
    await stepEvent(ctx);
    await stepTeam(ctx);
    stepPrompt(ctx);
    stepSeed(ctx);
    stepGithub(ctx);
    await stepBoard(ctx);
    await stepTokens(ctx);
    stepMessage(ctx);
    return ctx.boardCheckFailed ? 2 : 0;
  } catch (error) {
    if (error instanceof SetupError) {
      process.stderr.write(`\nSetup stopped: ${error.message}\nFix that and run ./hub setup again; finished steps are kept.\n`);
      return 1;
    }
    throw error;
  } finally {
    ctx.asker.close();
    if (!opts["dry-run"] && JSON.stringify(ctx.state) !== startState) {
      ensureStateIgnored(ctx);
      writeJsonIfChanged(join(hubDir, STATE_FILE), ctx.state);
    }
  }
}

// The state file holds no secrets, but it is this machine's, never the team's.
function ensureStateIgnored(ctx) {
  const path = join(ctx.hubDir, ".gitignore");
  const { text, added } = withIgnoreLines(readText(path) ?? "", [STATE_FILE]);
  if (added.length) writeIfChanged(path, text);
}

function invokedDirectly() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`setup failed: ${error instanceof Error ? error.stack : error}\n`);
      process.exitCode = 3;
    },
  );
}
