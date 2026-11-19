import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONFIG_FILE,
  configOrDefault,
  defaultConfig,
  isInstant,
  isTimeZone,
  loadConfig,
  parseConfig,
} from "../../lib/hub/config.mjs";

const templateRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function withEvent(overrides) {
  return { event: { ...defaultConfig().event, ...overrides } };
}

function withHub(overrides) {
  return { hub: { ...defaultConfig().hub, ...overrides } };
}

function scratchHub(contents) {
  const hubDir = mkdtempSync(join(tmpdir(), "hub-config-"));
  if (contents !== undefined) writeFileSync(join(hubDir, CONFIG_FILE), contents);
  return hubDir;
}

test("the defaults are a valid config", () => {
  const { data, error } = parseConfig(defaultConfig());
  assert.equal(error, null);
  assert.deepEqual(data, defaultConfig());
});

test("the config shipped in the template is valid", () => {
  const shipped = JSON.parse(readFileSync(join(templateRoot, CONFIG_FILE), "utf8"));
  assert.equal(parseConfig(shipped).error, null);
});

test("missing sections and keys fall back to the defaults", () => {
  const { data, error } = parseConfig({ event: { name: "Winter Hack", slug: "winter-hack" } });
  assert.equal(error, null);
  assert.equal(data.event.name, "Winter Hack");
  assert.equal(data.event.timezone, "America/New_York");
  assert.deepEqual(data.hub, defaultConfig().hub);
});

test("unknown keys are kept", () => {
  const { data } = parseConfig({ theme: "dark", event: { ...defaultConfig().event, venue: "Hall B" } });
  assert.equal(data.theme, "dark");
  assert.equal(data.event.venue, "Hall B");
});

test("a config that is not an object is refused", () => {
  for (const raw of [null, [], "text", 3]) {
    assert.match(parseConfig(raw).error, /JSON object/);
  }
});

test("bad event values are refused with the field named", () => {
  assert.match(parseConfig(withEvent({ name: "  " })).error, /event\.name/);
  assert.match(parseConfig(withEvent({ slug: "Winter Hack" })).error, /event\.slug/);
  assert.match(parseConfig(withEvent({ timezone: "Mars/Olympus" })).error, /event\.timezone/);
  assert.match(parseConfig(withEvent({ submitBy: "2027-01-17 09:00" })).error, /event\.submitBy/);
  assert.match(parseConfig(withEvent({ startsAt: "2027-01-15T18:00:00" })).error, /event\.startsAt/);
  assert.match(parseConfig(withEvent({ name: 7 })).error, /event\.name/);
});

test("bad hub values are refused with the field named", () => {
  assert.match(parseConfig(withHub({ repo: "just-a-name" })).error, /hub\.repo/);
  assert.match(parseConfig(withHub({ basePath: "hub" })).error, /hub\.basePath/);
  assert.match(parseConfig(withHub({ basePath: "/hub/" })).error, /hub\.basePath/);
  assert.match(parseConfig(withHub({ owner: "Ada" })).error, /hub\.owner/);
  assert.match(parseConfig({ hub: "nope" }).error, /"hub" must be an object/);
});

test("good hub values pass", () => {
  const { data, error } = parseConfig(withHub({ repo: "ada/winter-hack-hub", basePath: "/winter/hub", owner: "ada" }));
  assert.equal(error, null);
  assert.equal(data.hub.basePath, "/winter/hub");
});

test("times need an offset, time zones need to exist", () => {
  assert.equal(isInstant("2027-01-17T09:00:00-05:00"), true);
  assert.equal(isInstant("2027-01-17T14:00Z"), true);
  assert.equal(isInstant("2027-01-17T09:00:00"), false);
  assert.equal(isInstant("2027-13-45T09:00:00Z"), false);
  assert.equal(isTimeZone("America/Chicago"), true);
  assert.equal(isTimeZone(""), false);
});

test("loadConfig reads a hub folder and reports what is wrong", () => {
  const good = scratchHub(JSON.stringify({ event: { name: "Winter Hack", slug: "winter-hack" } }));
  assert.equal(loadConfig(good).data.event.slug, "winter-hack");

  const missing = scratchHub();
  assert.match(loadConfig(missing).error, /not found/);
  assert.equal(loadConfig(missing).data, null);

  const broken = scratchHub("{ not json");
  assert.match(loadConfig(broken).error, /not valid JSON/);

  const invalid = scratchHub(JSON.stringify(withHub({ basePath: "hub" })));
  assert.match(loadConfig(invalid).error, /hub\.config\.json: "hub\.basePath"/);
});

test("configOrDefault never fails", () => {
  assert.deepEqual(configOrDefault(scratchHub()), defaultConfig());
  assert.deepEqual(configOrDefault(scratchHub("{ not json")), defaultConfig());
});
