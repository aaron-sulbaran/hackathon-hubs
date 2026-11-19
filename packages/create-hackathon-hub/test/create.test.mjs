import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { envWithoutSecrets, isExcluded, nodeVersionError, parseCliArgs, shellPath } from "../index.mjs";
import { bundleLicense, bundleTemplate, cleanBundle } from "../scripts/bundle-template.mjs";

const HAS_GIT = spawnSync("git", ["--version"]).status === 0;
const POSIX = process.platform !== "win32";
const SECRETS = { HUB_KEY: "k-test", HUB_TOKEN: "t-test", HUB_READ_TOKEN: "r-test", HUB_WRITE_TOKEN: "w-test" };

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "index.mjs");

let work;
let fixture;

// Built at runtime, not committed: a committed .gitignore or .env inside the
// fixture would be read by git itself.
function writeFixture(dir) {
  const files = {
    "hub.config.json": '{ "v": 1 }\n',
    ".gitignore": "node_modules/\n.env\nshots/\n*.log\n.claude/settings.local.json\n",
    ".env.example": "HUB_KEY=\n",
    ".env.local": "HUB_KEY=secret\n",
    ".env": "HUB_KEY=secret\n",
    ".hub-me": "ada\n",
    ".hub-state.json": "{}\n",
    ".hub-owner.local": "ada\n",
    "tsconfig.tsbuildinfo": "{}\n",
    "kb/index.md": "# Knowledge\n",
    "node_modules/left-pad/index.js": "module.exports = 1;\n",
    "web/node_modules/x/index.js": "1\n",
    ".next/cache.json": "{}\n",
    ".vercel/project.json": "{}\n",
    ".hub-setup.local.json": "{}\n",
    ".claude/settings.json": "{}\n",
    ".claude/settings.local.json": "{}\n",
    "next-env.d.ts": "// generated\n",
    "shots/home.png": "png\n",
    "debug.log": "log\n",
    "hub":"#!/bin/sh\nexec node scripts/hub.mjs \"$@\"\n",
    // Records how it was called, and fails on demand so the resume path is testable.
    "scripts/setup.mjs": [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("setup-argv.json", JSON.stringify(process.argv.slice(2)));',
      'writeFileSync("setup-env.json", JSON.stringify({ HUB_KEY: process.env.HUB_KEY ?? null }));',
      'if (process.argv.includes("--fail")) process.exit(3);',
      "",
    ].join("\n"),
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  chmodSync(join(dir, "hub"), 0o755);
}

function run(args, { cwd = work, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CREATE_HACKATHON_HUB_TEMPLATE: "", ...env },
  });
}

function freshDir(name) {
  return join(mkdtempSync(join(work, "case-")), name);
}

// A repo whose template/ holds the fixture, with the gitignored files left
// untracked by git's own rules and one stray file never added.
function makeRepo() {
  const repo = mkdtempSync(join(work, "repo-"));
  const template = join(repo, "template");
  writeFixture(template);
  writeFileSync(join(repo, "LICENSE"), "MIT License\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  writeFileSync(join(template, "stray.txt"), "not tracked\n");
  return { repo, template };
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "create-hub-test-"));
  // Keeps git from finding a repo above the scratch folder.
  process.env.GIT_CEILING_DIRECTORIES = work;
  fixture = join(work, "fixture");
  writeFixture(fixture);
});

after(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("copy", () => {
  test("copies the template and leaves out local state, builds, and secrets", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-setup", "--no-git"]);
    assert.equal(result.status, 0, result.stderr);

    for (const kept of [
      "hub.config.json",
      ".gitignore",
      ".env.example",
      ".claude/settings.json",
      "kb/index.md",
      "hub",
      "scripts/setup.mjs",
    ]) {
      assert.ok(existsSync(join(target, kept)), `${kept} should be copied`);
    }
    for (const dropped of [
      ".env",
      ".env.local",
      ".hub-me",
      ".hub-state.json",
      ".hub-owner.local",
      "tsconfig.tsbuildinfo",
      "node_modules",
      "web/node_modules",
      ".next",
      ".vercel",
      ".hub-setup.local.json",
      ".claude/settings.local.json",
      "next-env.d.ts",
      "shots",
      "debug.log",
    ]) {
      assert.ok(!existsSync(join(target, dropped)), `${dropped} should be left out`);
    }
    assert.ok(statSync(join(target, "hub")).mode & 0o100, "./hub stays executable");
  });

  test("isExcluded keeps .env.example and drops other env files", () => {
    assert.equal(isExcluded(".env.example"), false);
    assert.equal(isExcluded(".env"), true);
    assert.equal(isExcluded(".env.production.local"), true);
    assert.equal(isExcluded(".gitignore"), false);
  });

  test("the template variable is used when no flag is given", () => {
    const target = freshDir("hub");
    const result = run([target, "--no-setup", "--no-git"], { env: { CREATE_HACKATHON_HUB_TEMPLATE: fixture } });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(target, "hub.config.json")));
  });
});

describe("pack bundle", { skip: !HAS_GIT }, () => {
  test("bundle stores _gitignore and the scaffolder restores .gitignore", () => {
    const { template } = makeRepo();
    const bundled = join(mkdtempSync(join(work, "bundle-")), "template");
    const result = bundleTemplate({ from: template, to: bundled });
    assert.equal(result.error, null);
    assert.ok(existsSync(join(bundled, "_gitignore")));
    assert.ok(!existsSync(join(bundled, ".gitignore")));

    const target = freshDir("hub");
    const created = run([target, "--template-dir", bundled, "--no-setup", "--no-git"]);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(readFileSync(join(target, ".gitignore"), "utf8"), readFileSync(join(template, ".gitignore"), "utf8"));
    assert.ok(!existsSync(join(target, "_gitignore")));
  });

  test("bundles only files git tracks, so local and ignored files never ship", () => {
    const { template } = makeRepo();
    const bundled = join(mkdtempSync(join(work, "bundle-")), "template");
    const result = bundleTemplate({ from: template, to: bundled });
    assert.equal(result.error, null);
    for (const kept of ["hub.config.json", "kb/index.md", "scripts/setup.mjs", ".claude/settings.json", ".env.example"]) {
      assert.ok(existsSync(join(bundled, kept)), `${kept} should be bundled`);
    }
    for (const dropped of [
      "stray.txt",
      "shots",
      "debug.log",
      ".claude/settings.local.json",
      "node_modules",
      ".env",
      ".env.local",
      ".hub-me",
      "next-env.d.ts",
      ".hub-setup.local.json",
    ]) {
      assert.ok(!existsSync(join(bundled, dropped)), `${dropped} should not be bundled`);
    }
    assert.ok(statSync(join(bundled, "hub")).mode & 0o100, "./hub stays executable in the bundle");
  });

  test("fails with a clear message outside a git checkout", () => {
    const bundled = join(mkdtempSync(join(work, "bundle-")), "template");
    const result = bundleTemplate({ from: fixture, to: bundled });
    assert.match(result.error, /Cannot list the files git tracks/);
    assert.ok(!existsSync(bundled));
  });

  test("copies the LICENSE in, and cleaning removes both copies", () => {
    const { repo, template } = makeRepo();
    const out = mkdtempSync(join(work, "pkg-"));
    const paths = { template: join(out, "template"), license: join(out, "LICENSE") };
    assert.equal(bundleTemplate({ from: template, to: paths.template }).error, null);
    assert.equal(bundleLicense({ from: join(repo, "LICENSE"), to: paths.license }).error, null);
    assert.equal(readFileSync(paths.license, "utf8"), "MIT License\n");
    cleanBundle(paths);
    assert.ok(!existsSync(paths.template));
    assert.ok(!existsSync(paths.license));
  });

  test("a missing LICENSE is an error", () => {
    const result = bundleLicense({ from: join(work, "no-license"), to: join(work, "LICENSE-out") });
    assert.match(result.error, /LICENSE not found/);
  });
});

describe("target folder", () => {
  test("refuses a folder that exists and is not empty, and changes nothing", () => {
    const target = freshDir("hub");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "notes.txt"), "mine\n");
    const result = run([target, "--template-dir", fixture, "--no-setup", "--no-git"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not empty/);
    assert.equal(readFileSync(join(target, "notes.txt"), "utf8"), "mine\n");
    assert.ok(!existsSync(join(target, "hub.config.json")));
  });

  test("accepts an existing empty folder", () => {
    const target = freshDir("hub");
    mkdirSync(target, { recursive: true });
    const result = run([target, "--template-dir", fixture, "--no-setup", "--no-git"]);
    assert.equal(result.status, 0, result.stderr);
  });

  test("--yes with no folder uses my-hackathon-hub in the current folder", () => {
    const cwd = mkdtempSync(join(work, "cwd-"));
    const result = run(["--yes", "--template-dir", fixture, "--no-setup", "--no-git"], { cwd });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(cwd, "my-hackathon-hub", "hub.config.json")));
  });
});

describe("git and setup", () => {
  test("--no-setup skips setup and prints how to run it", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-setup", "--no-git"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(join(target, "setup-argv.json")));
    assert.match(result.stdout, /\.\/hub setup/);
  });

  test("runs git init on main by default", { skip: spawnSync("git", ["--version"]).status !== 0 }, () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-setup"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(target, ".git")));
    const head = readFileSync(join(target, ".git", "HEAD"), "utf8");
    assert.match(head, /refs\/heads\/main/);
  });

  test("--no-git leaves the folder without a repo", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-setup", "--no-git"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(join(target, ".git")));
  });

  test("runs setup in the new folder and passes flags after --", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-git", "--", "--yes", "--name", "Sample Hackathon"]);
    assert.equal(result.status, 0, result.stderr);
    const argv = JSON.parse(readFileSync(join(target, "setup-argv.json"), "utf8"));
    assert.deepEqual(argv, ["--yes", "--name", "Sample Hackathon"]);
  });

  test("flags before -- are not passed to setup", () => {
    const target = freshDir("hub");
    const result = run(["--yes", target, "--template-dir", fixture, "--no-git"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(target, "setup-argv.json"), "utf8")), []);
  });

  test("when setup fails, says how to resume and exits non-zero", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--no-git", "--", "--fail"]);
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes(`cd ${target} && ./hub setup`), result.stderr);
  });

  test("git never sees the hub's secrets; setup does", { skip: !POSIX }, () => {
    // A fake git first on PATH records the environment it was given.
    const bin = mkdtempSync(join(work, "bin-"));
    const log = join(bin, "git-env.txt");
    writeFileSync(join(bin, "git"), `#!/bin/sh\nenv >> "${log}"\nexit 0\n`);
    chmodSync(join(bin, "git"), 0o755);

    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture], { env: { ...SECRETS, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr);
    const gitEnv = readFileSync(log, "utf8");
    assert.match(gitEnv, /^PATH=/m, "the fake git ran");
    for (const name of Object.keys(SECRETS)) assert.doesNotMatch(gitEnv, new RegExp(`^${name}=`, "m"));
    assert.deepEqual(JSON.parse(readFileSync(join(target, "setup-env.json"), "utf8")), { HUB_KEY: "k-test" });
  });

  test("envWithoutSecrets drops the four hub secrets and keeps the rest", () => {
    const clean = envWithoutSecrets({ ...SECRETS, PATH: "/bin", HOME: "/home/ada" });
    assert.deepEqual(clean, { PATH: "/bin", HOME: "/home/ada" });
  });
});

describe("printed cd hint", () => {
  test("shellPath leaves plain names alone and single-quotes the rest", () => {
    assert.equal(shellPath("my-hub"), "my-hub");
    assert.equal(shellPath("/tmp/a/my_hub.2"), "/tmp/a/my_hub.2");
    assert.equal(shellPath("my hub $(id)"), "'my hub $(id)'");
    assert.equal(shellPath("it's `x`"), `'it'\\''s \`x\`'`);
    assert.equal(shellPath("-hub"), "./-hub");
  });

  test("the printed cd reaches a hostile folder name without running anything", { skip: !POSIX }, () => {
    const parent = mkdtempSync(join(work, "quote-"));
    const name = "hub $(touch pwned) `touch pwned2` it's $HOME";
    const result = run([name, "--template-dir", fixture, "--no-setup", "--no-git"], { cwd: parent });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout.split("\n").find((l) => l.startsWith("Next: "));
    const cdCommand = line.slice("Next: ".length).replace(/ && \.\/hub setup$/, "");
    const shell = spawnSync("sh", ["-c", `${cdCommand} && pwd -P`], { cwd: parent, encoding: "utf8" });
    assert.equal(shell.status, 0, shell.stderr);
    assert.ok(shell.stdout.trim().endsWith(name), shell.stdout);
    assert.ok(!existsSync(join(parent, "pwned")));
    assert.ok(!existsSync(join(parent, "pwned2")));
  });
});

describe("arguments and environment", () => {
  test("rejects unknown options before touching the disk", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", fixture, "--bogus"]);
    assert.equal(result.status, 1);
    assert.ok(!existsSync(target));
  });

  test("reports a missing template folder", () => {
    const target = freshDir("hub");
    const result = run([target, "--template-dir", join(work, "nope"), "--no-setup"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Template folder not found/);
    assert.ok(!existsSync(target));
  });

  test("parseCliArgs splits at the first --", () => {
    const { data } = parseCliArgs(["hub", "--no-git", "--", "--no-git", "--", "x"]);
    assert.equal(data.folder, "hub");
    assert.equal(data["no-git"], true);
    assert.deepEqual(data.setupArgs, ["--no-git", "--", "x"]);
  });

  test("nodeVersionError rejects Node older than 20.9", () => {
    assert.match(nodeVersionError("20.8.1"), /needs Node 20\.9\.0/);
    assert.match(nodeVersionError("18.19.0"), /needs Node/);
    assert.equal(nodeVersionError("20.9.0"), null);
    assert.equal(nodeVersionError("22.0.0"), null);
  });
});
