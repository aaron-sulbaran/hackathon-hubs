#!/usr/bin/env node
// create-hackathon-hub: copy the hub template into a new folder, then hand off
// to the hub's own setup script. Node built-ins only, so `npm create` starts fast.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const MIN_NODE = [20, 9, 0];
export const DEFAULT_FOLDER = "my-hackathon-hub";
export const TEMPLATE_ENV = "CREATE_HACKATHON_HUB_TEMPLATE";

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

// Build output, local machine state, and secrets never travel with the template.
const EXCLUDED_NAMES = new Set([
  "node_modules",
  ".next",
  ".vercel",
  ".git",
  ".DS_Store",
  ".hub-me",
  ".hub-state.json",
  ".hub-owner.local",
  ".hub-setup.local.json",
  "settings.local.json",
  "tsconfig.tsbuildinfo",
  "next-env.d.ts",
  "shots",
]);
const ENV_FILE = /^\.env(\..*)?$/;

export function isExcluded(name) {
  if (EXCLUDED_NAMES.has(name)) return true;
  if (name.endsWith(".log")) return true;
  return ENV_FILE.test(name) && name !== ".env.example";
}

// npm drops `.gitignore` from published packages, so the bundle stores it as
// `_gitignore`. `gitignoreAs` names the file on the destination side.
export function copyTemplate(fromDir, toDir, { gitignoreAs = ".gitignore" } = {}) {
  mkdirSync(toDir, { recursive: true });
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    if (isExcluded(entry.name)) continue;
    const isGitignore = entry.name === ".gitignore" || entry.name === "_gitignore";
    const target = join(toDir, isGitignore ? gitignoreAs : entry.name);
    if (existsSync(target)) continue;
    const source = join(fromDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplate(source, target, { gitignoreAs });
    } else if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
    } else if (entry.isFile()) {
      // copyFileSync keeps the mode bits, which keeps ./hub executable.
      copyFileSync(source, target);
    }
  }
}

export function nodeVersionError(version = process.versions.node) {
  const have = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) > MIN_NODE[i]) return null;
    if ((have[i] ?? 0) < MIN_NODE[i]) {
      return `create-hackathon-hub needs Node ${MIN_NODE.join(".")} or newer; this is Node ${version}. Install a current Node from https://nodejs.org and run it again.`;
    }
  }
  return null;
}

export function findTemplate({ flag, env = process.env[TEMPLATE_ENV], packageDir = PACKAGE_DIR } = {}) {
  const explicit = flag || env;
  if (explicit) {
    const dir = resolve(explicit);
    if (!isDirectory(dir)) return { data: null, error: `Template folder not found: ${dir}` };
    return { data: dir, error: null };
  }
  for (const dir of [join(packageDir, "template"), resolve(packageDir, "../../template")]) {
    if (isDirectory(dir)) return { data: dir, error: null };
  }
  return { data: null, error: "No hub template found. Pass --template-dir <path>." };
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function checkTargetFolder(dir) {
  if (!existsSync(dir)) return { data: dir, error: null };
  if (!isDirectory(dir)) return { data: null, error: `${dir} exists and is not a folder.` };
  if (readdirSync(dir).length > 0) {
    return { data: null, error: `${dir} already exists and is not empty. Pick a new folder name; nothing was changed.` };
  }
  return { data: dir, error: null };
}

export function parseCliArgs(argv) {
  const split = argv.indexOf("--");
  const own = split === -1 ? argv : argv.slice(0, split);
  const setupArgs = split === -1 ? [] : argv.slice(split + 1);
  try {
    const { values, positionals } = parseArgs({
      args: own,
      allowPositionals: true,
      options: {
        yes: { type: "boolean", short: "y" },
        "no-setup": { type: "boolean" },
        "no-git": { type: "boolean" },
        "template-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
    if (positionals.length > 1) {
      return { data: null, error: `Expected one folder name, got: ${positionals.join(" ")}` };
    }
    return { data: { ...values, folder: positionals[0], setupArgs }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

const HELP = `Usage: create-hackathon-hub [folder] [options] [-- <flags passed to setup>]

Creates a hackathon hub in a new folder, then runs its setup.

Options:
  -y, --yes             Use the default folder name without asking.
                        Setup still asks its questions; pass -- --yes for that
  --no-setup            Copy the hub only; run ./hub setup later
  --no-git              Skip git init
  --template-dir <dir>  Copy this template instead of the bundled one
  -h, --help            Show this help
  -v, --version         Show the version
`;

async function askFolder() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Folder for the hub (${DEFAULT_FOLDER}): `);
    return answer.trim() || DEFAULT_FOLDER;
  } finally {
    rl.close();
  }
}

// Only setup may see the hub's secrets; git has no use for them.
export const SECRET_ENV = ["HUB_KEY", "HUB_TOKEN", "HUB_READ_TOKEN", "HUB_WRITE_TOKEN"];

export function envWithoutSecrets(env = process.env) {
  const clean = { ...env };
  for (const name of SECRET_ENV) delete clean[name];
  return clean;
}

function git(args, options = {}) {
  return spawnSync("git", args, { ...options, env: envWithoutSecrets() });
}

function hasGit() {
  return git(["--version"], { stdio: "ignore" }).status === 0;
}

// Quoted for a POSIX shell so a pasted `cd` never expands $(), backticks, or
// variables in the folder name. A leading dash would read as an option to cd.
export function shellPath(folder) {
  const path = folder.startsWith("-") ? `./${folder}` : folder;
  if (/^[\w./-]+$/.test(path)) return path;
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

export async function main(argv = process.argv.slice(2)) {
  const versionError = nodeVersionError();
  if (versionError) return fail(versionError);

  const args = parseCliArgs(argv);
  if (args.error) return fail(`${args.error}\n\n${HELP}`);
  const opts = args.data;
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
    console.log(pkg.version);
    return 0;
  }

  let folder = opts.folder;
  if (!folder) folder = opts.yes || !process.stdin.isTTY ? DEFAULT_FOLDER : await askFolder();
  const target = resolve(folder);

  const checked = checkTargetFolder(target);
  if (checked.error) return fail(checked.error);

  const template = findTemplate({ flag: opts["template-dir"] });
  if (template.error) return fail(template.error);

  copyTemplate(template.data, target);
  // Echo the folder the way the user typed it, so the printed `cd` works as pasted.
  const shown = shellPath(folder);
  console.log(`Created a hackathon hub in ${shown}`);

  if (!opts["no-git"]) {
    if (!hasGit()) {
      console.log("git not found, so the folder is not a git repo yet.");
    } else {
      const init = git(["init", "-q", "-b", "main"], { cwd: target, stdio: "inherit" });
      if (init.status !== 0) console.log("git init failed; run `git init -b main` in the folder yourself.");
    }
  }

  const resume = `cd ${shown} && ./hub setup`;
  if (opts["no-setup"]) {
    console.log(`\nNext: ${resume}`);
    return 0;
  }

  const setupScript = join(target, "scripts", "setup.mjs");
  if (!existsSync(setupScript)) {
    console.log(`\nThis template has no scripts/setup.mjs, so setup was skipped.\nNext: cd ${shown}`);
    return 0;
  }

  const setup = spawnSync(process.execPath, [setupScript, ...opts.setupArgs], { cwd: target, stdio: "inherit" });
  if (setup.status !== 0) {
    console.error(`\nSetup did not finish. Fix the problem above, then resume with:\n  ${resume}`);
    return setup.status || 1;
  }

  console.log(`\nYour hub is ready in ${shown}.\nNext: cd ${shown}, then send your team the message setup printed above.`);
  return 0;
}

function fail(message) {
  console.error(message);
  return 1;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().then((code) => {
    process.exitCode = code;
  });
}
