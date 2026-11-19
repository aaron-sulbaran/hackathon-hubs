#!/usr/bin/env node
// Runs on `prepack`: copies the repo's template/ and LICENSE into this package
// so npm ships them. `--clean` (run on `postpack`) removes both copies again,
// so a checkout keeps reading ../../template instead of a stale bundle.
//
// Only files git tracks are bundled. A maintainer's template/ folder collects
// local files (Claude Code settings, screenshots, logs, generated types) that
// must never reach every new hub through npm.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envWithoutSecrets, isExcluded } from "../index.mjs";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIR = resolve(PACKAGE_DIR, "../..");

export function trackedFiles(dir) {
  const result = spawnSync("git", ["ls-files", "-z", "--", "."], {
    cwd: dir,
    encoding: "utf8",
    env: envWithoutSecrets(),
  });
  if (result.error || result.status !== 0) {
    const reason = result.error ? result.error.message : result.stderr.trim();
    return { data: null, error: `Cannot list the files git tracks in ${dir}: ${reason}. Pack from a git checkout of the repo.` };
  }
  const files = result.stdout.split("\0").filter(Boolean);
  if (files.length === 0) return { data: null, error: `git tracks no files in ${dir}. Commit the template before packing.` };
  return { data: files, error: null };
}

export function bundleTemplate({ from = join(REPO_DIR, "template"), to = join(PACKAGE_DIR, "template") } = {}) {
  if (!existsSync(from)) return { data: null, error: `Template folder not found: ${from}` };
  const listed = trackedFiles(from);
  if (listed.error) return listed;

  rmSync(to, { recursive: true, force: true });
  let copied = 0;
  for (const file of listed.data) {
    const parts = file.split("/");
    if (parts.some(isExcluded)) continue;
    const source = join(from, file);
    // A tracked file deleted in the working tree has nothing to copy.
    if (!existsSync(source) && !isSymlink(source)) continue;
    if (parts.at(-1) === ".gitignore") parts[parts.length - 1] = "_gitignore";
    const target = join(to, ...parts);
    mkdirSync(dirname(target), { recursive: true });
    if (isSymlink(source)) symlinkSync(readlinkSync(source), target);
    else copyFileSync(source, target);
    copied++;
  }
  return { data: { dir: to, files: copied }, error: null };
}

export function bundleLicense({ from = join(REPO_DIR, "LICENSE"), to = join(PACKAGE_DIR, "LICENSE") } = {}) {
  if (!existsSync(from)) return { data: null, error: `LICENSE not found at ${from}; the package must carry the MIT text.` };
  copyFileSync(from, to);
  return { data: to, error: null };
}

export function cleanBundle({ template = join(PACKAGE_DIR, "template"), license = join(PACKAGE_DIR, "LICENSE") } = {}) {
  rmSync(template, { recursive: true, force: true });
  rmSync(license, { force: true });
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--clean")) {
    cleanBundle();
  } else {
    const template = bundleTemplate();
    const license = template.error ? template : bundleLicense();
    if (license.error) {
      cleanBundle();
      console.error(`prepack failed: ${license.error}`);
      process.exitCode = 1;
    } else {
      // stderr, so `npm pack --json` output stays parseable.
      console.error(`Bundled ${template.data.files} template files and LICENSE.`);
    }
  }
}
