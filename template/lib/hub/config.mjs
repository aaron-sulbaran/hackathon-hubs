// The one place event-specific settings live. Read by the hub CLI, the web
// board, and setup. Node built-ins only: teammates run ./hub before any install.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "hub.config.json";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const BASE_PATH = /^(\/[a-z0-9][a-z0-9-]*)*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PERSON_ID = /^[a-z][a-z0-9_]*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function defaultConfig() {
  return {
    v: 1,
    event: {
      name: "Sample Hackathon",
      slug: "sample-hackathon",
      timezone: "America/New_York",
      startsAt: "",
      submitBy: "",
      location: "",
      url: "",
    },
    hub: { repo: "", basePath: "", owner: "" },
  };
}

export function isTimeZone(value) {
  if (typeof value !== "string" || value === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A moment in time with its offset spelled out, so nobody has to guess the zone.
export function isInstant(value) {
  return typeof value === "string" && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeSection(name, defaults, given) {
  if (given === undefined) return { data: { ...defaults }, error: null };
  if (!isPlainObject(given)) return { data: null, error: `"${name}" must be an object.` };
  for (const key of Object.keys(defaults)) {
    if (given[key] !== undefined && typeof given[key] !== "string") {
      return { data: null, error: `"${name}.${key}" must be a string.` };
    }
  }
  // Unknown keys ride along so a newer hub can add settings without breaking this reader.
  return { data: { ...defaults, ...given }, error: null };
}

function firstProblem(config) {
  const { event, hub } = config;
  if (event.name.trim() === "") return '"event.name" is empty.';
  if (!SLUG.test(event.slug)) return '"event.slug" must be lowercase letters, digits, and dashes.';
  if (!isTimeZone(event.timezone)) return `"event.timezone" is not a time zone this machine knows: ${event.timezone}`;
  for (const key of ["startsAt", "submitBy"]) {
    if (event[key] !== "" && !isInstant(event[key])) {
      return `"event.${key}" must be empty or a time with its offset, like 2027-01-17T09:00:00-05:00.`;
    }
  }
  if (hub.repo !== "" && !REPO.test(hub.repo)) return '"hub.repo" must be empty or owner/name.';
  if (!BASE_PATH.test(hub.basePath)) return '"hub.basePath" must be empty or start with a slash and not end with one, like /hub.';
  if (hub.owner !== "" && !PERSON_ID.test(hub.owner)) return '"hub.owner" must be empty or a team id.';
  return null;
}

export function parseConfig(raw) {
  if (!isPlainObject(raw)) return { data: null, error: "The config must be a JSON object." };
  const defaults = defaultConfig();
  const event = mergeSection("event", defaults.event, raw.event);
  if (event.error) return { data: null, error: event.error };
  const hub = mergeSection("hub", defaults.hub, raw.hub);
  if (hub.error) return { data: null, error: hub.error };
  const config = { ...raw, v: 1, event: event.data, hub: hub.data };
  const problem = firstProblem(config);
  return problem ? { data: null, error: problem } : { data: config, error: null };
}

export function loadConfig(hubDir) {
  const file = join(hubDir, CONFIG_FILE);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { data: null, error: `${CONFIG_FILE} not found in ${hubDir}. Run ./hub setup.` };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: null, error: `${CONFIG_FILE} is not valid JSON.` };
  }
  const parsed = parseConfig(raw);
  return parsed.error ? { data: null, error: `${CONFIG_FILE}: ${parsed.error}` } : parsed;
}

// For callers that must keep working on a hub nobody has set up yet.
export function configOrDefault(hubDir) {
  return loadConfig(hubDir).data ?? defaultConfig();
}
