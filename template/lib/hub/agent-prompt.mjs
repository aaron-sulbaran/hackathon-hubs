// Fills docs/agent-prompt.template.md with this event's details, so the
// onboarding prompt a teammate pastes names the right repo, ids, and deadline.
// Node built-ins only: setup runs before any install.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROMPT_TEMPLATE_FILE = join("docs", "agent-prompt.template.md");
export const PROMPT_FILE = join("docs", "agent-prompt.md");

const RENDERED_NOTE =
  "<!-- Written by ./hub setup from docs/agent-prompt.template.md. Edit the template, then run ./hub setup again. -->\n\n";

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

const defaultTemplatePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", PROMPT_TEMPLATE_FILE);

export function listWithOr(items) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

export function teamSizePhrase(count) {
  const word = NUMBER_WORDS[count] ?? String(count);
  return `${word} ${count === 1 ? "teammate" : "teammates"}`;
}

export function repoUrl(config) {
  const repo = config.hub.repo || `<owner>/${config.event.slug}-hub`;
  return `https://github.com/${repo}.git`;
}

// "Submissions are due Sun, Jan 17, 9:00 AM EST" in the event's own zone.
export function deadlineLine(config) {
  const { submitBy, timezone } = config.event;
  if (!submitBy || Number.isNaN(Date.parse(submitBy))) return "The clock is running, so keep this quick.";
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(submitBy));
  return `Submissions are due ${when}, so keep this quick.`;
}

export function ownerFirstName(config, team) {
  const owner = team.people.find((person) => person.id === config.hub.owner);
  const first = owner?.name?.trim().split(/\s+/)[0];
  return first || "the hub owner";
}

export function promptValues(config, team) {
  const ids = team.people.map((person) => person.id);
  const cloneParent = `~/${config.event.slug}`;
  return {
    EVENT_NAME: config.event.name,
    TEAM_SIZE: teamSizePhrase(ids.length),
    TEAM_IDS: ids.join(", "),
    TEAM_IDS_OR: listWithOr(ids),
    REPO_URL: repoUrl(config),
    CLONE_PARENT: cloneParent,
    CLONE_DIR: `${cloneParent}/hub`,
    DEADLINE_LINE: deadlineLine(config),
    OWNER_NAME: ownerFirstName(config, team),
  };
}

export function fillTemplate(text, values) {
  const unknown = [];
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (token, name) => {
    if (Object.hasOwn(values, name)) return values[name];
    unknown.push(name);
    return token;
  });
  if (unknown.length) return { data: null, error: `Unknown template fields: ${[...new Set(unknown)].join(", ")}` };
  if (filled.includes("{{")) return { data: null, error: "The template has a {{ that is not a field." };
  return { data: filled, error: null };
}

// config is a parsed hub.config.json, team is team.json. templateText defaults
// to the template shipped next to this hub.
export function renderAgentPrompt(config, team, templateText) {
  if (!team || !Array.isArray(team.people) || team.people.length === 0) {
    return { data: null, error: "team.json has nobody in it." };
  }
  let text = templateText;
  if (text === undefined) {
    try {
      text = readFileSync(defaultTemplatePath, "utf8");
    } catch {
      return { data: null, error: `${PROMPT_TEMPLATE_FILE} not found.` };
    }
  }
  const filled = fillTemplate(text, promptValues(config, team));
  if (filled.error) return filled;
  return { data: RENDERED_NOTE + filled.data, error: null };
}
