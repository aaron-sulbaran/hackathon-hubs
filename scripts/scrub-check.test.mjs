// Scrub check tests against throwaway git repos. Run: node --test scripts/scrub-check.test.mjs
// Every risky sample below is built by joining pieces, so this file passes its own check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "scrub-check.mjs");
const ZERO = "0".repeat(40);
const NOREPLY = "1+ada-example@users.noreply.github.com";
const PERSONAL = "ada.lovelace" + "@" + "personalmail.io";

function baseEnv(extra = {}) {
  const env = { ...process.env };
  delete env.SCRUB_TERMS;
  delete env.SCRUB_ALLOW_IDENTITY;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Ada Example",
    GIT_AUTHOR_EMAIL: NOREPLY,
    GIT_COMMITTER_NAME: "Ada Example",
    GIT_COMMITTER_EMAIL: NOREPLY,
    ...extra,
  };
}

function git(cwd, args, env = {}) {
  const result = spawnSync("git", args, { cwd, env: baseEnv(env), encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function makeRepo(files = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "scrub-check-")));
  git(dir, ["init", "-q", "-b", "main"]);
  writeFiles(dir, { "README.md": "# Sample\n", ...files });
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "First commit"]);
  return dir;
}

function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function scrub(cwd, args, { env = {}, input } = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: baseEnv(env), input, encoding: "utf8" });
  return { code: result.status, out: result.stdout + result.stderr };
}

function tracked(files, options) {
  const dir = makeRepo(files);
  try {
    return scrub(dir, ["--tracked"], options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a clean repo exits 0 and says only the built-in checks ran", () => {
  const { code, out } = tracked({ "notes.md": "Nothing to see here.\n" });
  assert.equal(code, 0, out);
  assert.match(out, /only the built-in checks ran/);
});

test("usage errors exit 2", () => {
  const dir = makeRepo();
  try {
    assert.equal(scrub(dir, []).code, 2);
    assert.equal(scrub(dir, ["--pre-push"]).code, 2);
    assert.equal(scrub(dir, ["--tracked"], { env: { SCRUB_TERMS: path.join(dir, "missing.txt") } }).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("email: a personal address hits, allowed shapes pass", () => {
  const hit = tracked({ "a.md": `Write to ${PERSONAL}\n` });
  assert.equal(hit.code, 1);
  assert.match(hit.out, /a\.md:1: email:/);

  const allowed = [
    NOREPLY,
    "noreply" + "@anthropic.com",
    "noreply" + "@github.com",
    "git" + "@github.com:owner/repo.git",
    "ada" + "@example.com",
    "grace" + "@example.org",
    "linus" + "@example.net",
    "ada" + "@school.example",
    "ada" + "@hub.test",
    "ada" + "@nowhere.invalid",
    "https://x-access-token:%s" + "@github.com",
    "react" + "@19.1.0",
  ].join("\n");
  const pass = tracked({ "b.md": allowed + "\n" });
  assert.equal(pass.code, 0, pass.out);
});

test("secrets: token shapes, a private key header, and a real-looking unlock link hit", () => {
  const samples = {
    "gh.txt": "token = " + "gh" + "p_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5" + "\n",
    "pat.txt": "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnop" + "\n",
    "aws.txt": "AKIA" + "Q3EGRZ7WJ2LMNOPQ" + "\n",
    "pem.txt": "-----BEGIN " + "RSA PRIVATE KEY-----" + "\n",
    "unlock.txt": "https://hub.vercel.app/unlock" + "?key=" + "q8Zr2Lm4Vt9Xw1Yc6Pd3" + "\n",
  };
  const { code, out } = tracked(samples);
  assert.equal(code, 1);
  assert.match(out, /gh\.txt:1: secret \(GitHub token\)/);
  assert.match(out, /pat\.txt:1: secret \(GitHub token\)/);
  assert.match(out, /aws\.txt:1: secret \(AWS access key\)/);
  assert.match(out, /pem\.txt:1: secret \(private key\)/);
  assert.match(out, /unlock\.txt:1: unlock link/);
});

test("secrets: placeholders pass", () => {
  const placeholders = [
    "unlock" + "?key=<HUB_KEY>",
    "unlock" + "?key=YOUR_KEY_GOES_RIGHT_HERE_OK",
    "unlock" + "?key=$HUB_KEY_VALUE_FROM_ENVIRONMENT",
    "unlock" + "?key=${HUB_KEY}",
    "unlock" + "?key=short",
    "github" + "_pat_ONE_example_value_0001_abcdefgh",
  ].join("\n");
  const { code, out } = tracked({ "p.md": placeholders + "\n" });
  assert.equal(code, 0, out);
});

test("home paths: real names hit, placeholders pass", () => {
  const hit = tracked({
    "mac.md": "/Us" + "ers/alice/code\n",
    "linux.md": "/ho" + "me/bob/code\n",
    "win.md": "C:\\Us" + "ers\\carol\\code\n",
  });
  assert.equal(hit.code, 1);
  assert.match(hit.out, /mac\.md:1: home path/);
  assert.match(hit.out, /linux\.md:1: home path/);
  assert.match(hit.out, /win\.md:1: home path/);

  const pass = tracked({ "ok.md": ["/Us" + "ers/you/code", "/ho" + "me/user/code", "/Us" + "ers/<name>/code"].join("\n") + "\n" });
  assert.equal(pass.code, 0, pass.out);
});

test("private artifact links hit", () => {
  const { code, out } = tracked({ "link.md": "See https://claude.ai/" + "artifact/abc123\n" });
  assert.equal(code, 1);
  assert.match(out, /link\.md:1: private artifact link/);
});

test("the escape hatch skips built-in checks on its line only", () => {
  const { code, out } = tracked({
    "hatch.md": `Write to ${PERSONAL} <!-- scrub-check: ` + "allow -->\n" + `And ${PERSONAL}\n`,
  });
  assert.equal(code, 1);
  assert.doesNotMatch(out, /hatch\.md:1:/);
  assert.match(out, /hatch\.md:2: email/);
});

test("binary files are scanned too, with byte offsets, and their paths are checked", () => {
  const dir = makeRepo();
  try {
    const token = "gh" + "p_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
    writeFileSync(path.join(dir, "zebrafish.bin"), Buffer.from([0, 1, 2, ...Buffer.from(PERSONAL)]));
    writeFileSync(path.join(dir, "stray.bin"), Buffer.concat([Buffer.from("token = "), Buffer.from([0]), Buffer.from(token)]));
    writeFileSync(path.join(dir, "wide.bin"), Buffer.from("key " + token + "\n", "utf16le"));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "Add binaries"]);
    const terms = path.join(dir, "..", path.basename(dir) + "-terms.txt");
    writeFileSync(terms, "zebrafish\n");
    try {
      const { code, out } = scrub(dir, ["--tracked"], { env: { SCRUB_TERMS: terms } });
      assert.equal(code, 1);
      assert.match(out, /zebrafish\.bin: path: private term: zebrafish/);
      assert.match(out, /zebrafish\.bin: byte 3 \(binary\): email/);
      assert.match(out, /stray\.bin: byte 9 \(binary\): secret \(GitHub token\)/);
      assert.match(out, /wide\.bin: byte 8 \(binary, utf-16\): secret \(GitHub token\)/);
    } finally {
      rmSync(terms, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file over the size limit is a hit unless SCRUB_ALLOW_LARGE names it", () => {
  const dir = makeRepo();
  try {
    writeFiles(dir, { "assets/big.bin": Buffer.alloc(5 * 1024 * 1024 + 1, 7), "small.bin": Buffer.alloc(5 * 1024 * 1024, 7) });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "Add a large file"]);
    const blocked = scrub(dir, ["--tracked"]);
    assert.equal(blocked.code, 1, blocked.out);
    assert.match(blocked.out, /assets\/big\.bin: too large to scan \(5242881 bytes, over the 5 MB limit\)/);
    assert.match(blocked.out, /SCRUB_ALLOW_LARGE=assets\/big\.bin/);
    assert.doesNotMatch(blocked.out, /small\.bin/);

    const allowed = scrub(dir, ["--tracked"], { env: { SCRUB_ALLOW_LARGE: "other.bin, assets/big.bin" } });
    assert.equal(allowed.code, 0, allowed.out);
    assert.match(allowed.out, /WARNING: assets\/big\.bin is 5242881 bytes.*UNSCANNED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("private terms: hits in content, with ! allowed terms ignored", () => {
  const dir = makeRepo({
    "LICENSE": "Copyright (c) 2026 Ada Lovelace\n",
    "notes.md": "Lovelace said so\n",
  });
  const terms = path.join(dir, "..", path.basename(dir) + "-terms.txt");
  writeFileSync(terms, "# comment line\nlovelace\n\n!Ada Lovelace\n");
  try {
    const { code, out } = scrub(dir, ["--tracked"], { env: { SCRUB_TERMS: terms } });
    assert.equal(code, 1);
    assert.match(out, /notes\.md:1: private term: lovelace/);
    assert.doesNotMatch(out, /LICENSE/);
    assert.doesNotMatch(out, /comment line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(terms, { force: true });
  }
});

test("the terms file is found in the main worktree from a linked worktree", () => {
  const dir = makeRepo({ "notes.md": "the zebrafish project\n" });
  const linked = dir + "-linked";
  try {
    writeFiles(dir, { ".private/scrub-terms.txt": "zebrafish\n" });
    git(dir, ["worktree", "add", "-q", linked]);
    const { code, out } = scrub(linked, ["--tracked"]);
    assert.equal(code, 1);
    assert.match(out, /notes\.md:1: private term: zebrafish/);
  } finally {
    rmSync(linked, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

function pushRepo() {
  const dir = makeRepo({ "notes.md": "clean\n" });
  const remote = dir + "-remote.git";
  git(dir, ["init", "-q", "--bare", remote]);
  git(dir, ["remote", "add", "origin", remote]);
  return { dir, remote, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(remote, { recursive: true, force: true }); } };
}

function prePush(dir, lines, env) {
  return scrub(dir, ["--pre-push", "origin", "unused-url"], { env, input: lines.join("\n") + "\n" });
}

test("pre-push: a new branch with noreply commits passes", () => {
  const { dir, cleanup } = pushRepo();
  try {
    const sha = git(dir, ["rev-parse", "HEAD"]);
    const { code, out } = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${ZERO}`]);
    assert.equal(code, 0, out);
  } finally {
    cleanup();
  }
});

test("pre-push: a personal committer email is blocked, and SCRUB_ALLOW_IDENTITY=1 skips it loudly", () => {
  const { dir, cleanup } = pushRepo();
  try {
    git(dir, ["push", "-q", "origin", "main"]);
    const before = git(dir, ["rev-parse", "HEAD"]);
    writeFiles(dir, { "more.md": "still clean\n" });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "More"], { GIT_COMMITTER_EMAIL: PERSONAL });
    const sha = git(dir, ["rev-parse", "HEAD"]);
    const line = `refs/heads/main ${sha} refs/heads/main ${before}`;

    const blocked = prePush(dir, [line]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /identity: committer email .* is not a noreply address/);

    const allowed = prePush(dir, [line], { SCRUB_ALLOW_IDENTITY: "1" });
    assert.equal(allowed.code, 0, allowed.out);
    assert.match(allowed.out, /WARNING: SCRUB_ALLOW_IDENTITY=1/);
  } finally {
    cleanup();
  }
});

test("pre-push: commit messages, author identity, and files changed in earlier new commits are checked", () => {
  const { dir, cleanup } = pushRepo();
  const terms = dir + "-terms.txt";
  writeFileSync(terms, "zebrafish\n");
  try {
    writeFiles(dir, { "leak.md": `Write to ${PERSONAL}\n` });
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "Add the zebrafish notes"], { GIT_AUTHOR_NAME: "Zebrafish Fan" });
    git(dir, ["rm", "-q", "leak.md"]);
    git(dir, ["commit", "-q", "-m", "Remove notes"]);
    const sha = git(dir, ["rev-parse", "HEAD"]);
    const { code, out } = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${ZERO}`], { SCRUB_TERMS: terms });
    assert.equal(code, 1);
    assert.match(out, /message:1: private term: zebrafish/);
    assert.match(out, /author name: private term: zebrafish/);
    assert.match(out, /leak\.md@[0-9a-f]+:1: email/);
  } finally {
    cleanup();
    rmSync(terms, { force: true });
  }
});

test("pre-push: a deleted ref and empty stdin pass", () => {
  const { dir, cleanup } = pushRepo();
  try {
    const sha = git(dir, ["rev-parse", "HEAD"]);
    assert.equal(prePush(dir, [`(delete) ${ZERO} refs/heads/old ${sha}`]).code, 0);
    assert.equal(scrub(dir, ["--pre-push", "origin", "url"], { input: "" }).code, 0);
  } finally {
    cleanup();
  }
});

function withTerms(dir, text) {
  const file = dir + "-terms.txt";
  writeFileSync(file, text);
  return file;
}

function commitAll(dir, message, env) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message], env);
  return git(dir, ["rev-parse", "HEAD"]);
}

test("pre-push: every path is checked, even when its contents match a blob already seen", () => {
  const { dir, cleanup } = pushRepo();
  const terms = withTerms(dir, "zebrafish\n");
  try {
    // The same bytes as notes.md, under a private name, only in an intermediate commit.
    writeFiles(dir, { "zebrafish-plan.md": "clean\n" });
    commitAll(dir, "Add a copy");
    git(dir, ["mv", "zebrafish-plan.md", "renamed.md"]);
    commitAll(dir, "Rename it");
    git(dir, ["rm", "-q", "renamed.md"]);
    const sha = commitAll(dir, "Remove it");
    // A second ref whose tip carries the same clean blob under another private name.
    git(dir, ["checkout", "-q", "-b", "side"]);
    writeFiles(dir, { "zebrafish/other.md": "clean\n" });
    const side = commitAll(dir, "Side copy");
    const lines = [`refs/heads/main ${sha} refs/heads/main ${ZERO}`, `refs/heads/side ${side} refs/heads/side ${ZERO}`];
    const { code, out } = prePush(dir, lines, { SCRUB_TERMS: terms });
    assert.equal(code, 1, out);
    assert.match(out, /zebrafish-plan\.md@[0-9a-f]+: path: private term: zebrafish/);
    assert.match(out, /zebrafish\/other\.md@[0-9a-f]+: path: private term: zebrafish/);
  } finally {
    cleanup();
    rmSync(terms, { force: true });
  }
});

test("pre-push: content that exists only in a merge resolution is scanned", () => {
  const { dir, cleanup } = pushRepo();
  try {
    git(dir, ["push", "-q", "origin", "main"]);
    const base = git(dir, ["rev-parse", "HEAD"]);
    git(dir, ["checkout", "-q", "-b", "topic"]);
    writeFiles(dir, { "notes.md": "topic side\n" });
    commitAll(dir, "Topic change");
    git(dir, ["checkout", "-q", "main"]);
    writeFiles(dir, { "notes.md": "main side\n" });
    commitAll(dir, "Main change");
    const merge = spawnSync("git", ["merge", "-q", "topic", "-m", "Merge topic"], { cwd: dir, env: baseEnv(), encoding: "utf8" });
    assert.notEqual(merge.status, 0, "the merge should conflict");
    writeFiles(dir, { "notes.md": `resolved, write to ${PERSONAL}\n` });
    const mergeSha = commitAll(dir, "Merge topic");
    assert.equal(git(dir, ["rev-list", "--parents", "-n", "1", mergeSha]).split(" ").length, 3, "a real merge commit");
    writeFiles(dir, { "notes.md": "resolved\n" });
    const tip = commitAll(dir, "Tidy the resolution");
    const { code, out } = prePush(dir, [`refs/heads/main ${tip} refs/heads/main ${base}`]);
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`notes\\.md@${mergeSha.slice(0, 10)}:1: email`));
  } finally {
    cleanup();
  }
});

test("pre-push: symlink targets, submodule paths, and empty folder names are checked", () => {
  const { dir, cleanup } = pushRepo();
  const terms = withTerms(dir, "zebrafish\n");
  try {
    symlinkSync("../zebrafish-notes/plan.md", path.join(dir, "link.md"));
    const submoduleCommit = git(dir, ["rev-parse", "HEAD"]);
    git(dir, ["update-index", "--add", "--cacheinfo", `160000,${submoduleCommit},vendor/zebrafish-sdk`]);
    git(dir, ["add", "link.md"]);
    git(dir, ["commit", "-q", "-m", "Link and submodule"]);
    // An empty folder can only be made by hand, with mktree.
    const emptyTree = spawnSync("git", ["hash-object", "-t", "tree", "-w", "--stdin"], { cwd: dir, env: baseEnv(), input: "", encoding: "utf8" }).stdout.trim();
    const listing = git(dir, ["ls-tree", "HEAD"]) + `\n040000 tree ${emptyTree}\tzebrafish-empty\n`;
    const withEmpty = spawnSync("git", ["mktree"], { cwd: dir, env: baseEnv(), input: listing, encoding: "utf8" }).stdout.trim();
    const sha = git(dir, ["commit-tree", withEmpty, "-p", "HEAD", "-m", "Empty folder"]);
    const { code, out } = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${ZERO}`], { SCRUB_TERMS: terms });
    assert.equal(code, 1, out);
    assert.match(out, /link\.md@[0-9a-f]+:1: private term: zebrafish/);
    assert.match(out, /vendor\/zebrafish-sdk@[0-9a-f]+: path: private term: zebrafish/);
    assert.match(out, /zebrafish-empty@[0-9a-f]+: path: private term: zebrafish/);
  } finally {
    cleanup();
    rmSync(terms, { force: true });
  }
});

test("pre-push: a pushed tag checks its name, message, tagger, and the commits it brings", () => {
  const { dir, cleanup } = pushRepo();
  const terms = withTerms(dir, "zebrafish\n");
  try {
    git(dir, ["push", "-q", "origin", "main"]);
    git(dir, ["checkout", "-q", "--detach"]);
    writeFiles(dir, { "leak.md": `Write to ${PERSONAL}\n` });
    commitAll(dir, "Only on the tag");
    git(dir, ["tag", "-a", "v1-zebrafish", "-m", "Release for zebrafish"], { GIT_COMMITTER_EMAIL: PERSONAL });
    const tag = git(dir, ["rev-parse", "v1-zebrafish"]);
    const { code, out } = prePush(dir, [`refs/tags/v1-zebrafish ${tag} refs/tags/v1-zebrafish ${ZERO}`], { SCRUB_TERMS: terms });
    assert.equal(code, 1, out);
    assert.match(out, /ref refs\/tags\/v1-zebrafish: private term: zebrafish/);
    assert.match(out, /tag [0-9a-f]+ name: private term: zebrafish/);
    assert.match(out, /tag [0-9a-f]+ message:1: private term: zebrafish/);
    assert.match(out, /tag [0-9a-f]+: identity: tagger email .* is not a noreply address/);
    assert.match(out, /leak\.md@[0-9a-f]+:1: email/);
  } finally {
    cleanup();
    rmSync(terms, { force: true });
  }
});

test("pre-push: a force push scans what the remote does not have", () => {
  const { dir, cleanup } = pushRepo();
  try {
    writeFiles(dir, { "more.md": "pushed\n" });
    const pushed = commitAll(dir, "Pushed");
    git(dir, ["push", "-q", "origin", "main"]);
    git(dir, ["reset", "-q", "--hard", "HEAD~1"]);
    writeFiles(dir, { "rewrite.md": `Write to ${PERSONAL}\n` });
    commitAll(dir, "Rewrite with a leak");
    writeFiles(dir, { "rewrite.md": "clean now\n" });
    const tip = commitAll(dir, "Clean it");
    const { code, out } = prePush(dir, [`refs/heads/main ${tip} refs/heads/main ${pushed}`]);
    assert.equal(code, 1, out);
    assert.match(out, /rewrite\.md@[0-9a-f]+:1: email/);
  } finally {
    cleanup();
  }
});

test("pre-push: an author email is checked as well as the committer's", () => {
  const { dir, cleanup } = pushRepo();
  try {
    writeFiles(dir, { "more.md": "clean\n" });
    const sha = commitAll(dir, "More", { GIT_AUTHOR_EMAIL: PERSONAL });
    const { code, out } = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${ZERO}`]);
    assert.equal(code, 1, out);
    assert.match(out, /identity: author email .* is not a noreply address/);
  } finally {
    cleanup();
  }
});

test("pre-push: replace objects do not hide the real commit", () => {
  const { dir, cleanup } = pushRepo();
  try {
    writeFiles(dir, { "leak.md": `Write to ${PERSONAL}\n` });
    const real = commitAll(dir, "Real");
    git(dir, ["reset", "-q", "--hard", "HEAD~1"]);
    writeFiles(dir, { "leak.md": "nothing\n" });
    const decoy = commitAll(dir, "Decoy");
    git(dir, ["replace", real, decoy]);
    const { code, out } = prePush(dir, [`refs/heads/main ${real} refs/heads/main ${ZERO}`]);
    assert.equal(code, 1, out);
    assert.match(out, /leak\.md@[0-9a-f]+:1: email/);
  } finally {
    cleanup();
  }
});

test("pre-push: what the check cannot vouch for, and git errors, exit 2", () => {
  const { dir, cleanup } = pushRepo();
  try {
    const sha = git(dir, ["rev-parse", "HEAD"]);
    const unknown = "1234567890".repeat(4);

    const missingRemote = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${unknown}`]);
    assert.equal(missingRemote.code, 2, missingRemote.out);
    assert.match(missingRemote.out, /this clone does not have.*git fetch origin/);

    const missingLocal = prePush(dir, [`refs/heads/main ${unknown} refs/heads/main ${ZERO}`]);
    assert.equal(missingLocal.code, 2, missingLocal.out);

    const blob = git(dir, ["rev-parse", "HEAD:notes.md"]);
    const blobRef = prePush(dir, [`refs/tags/raw ${blob} refs/tags/raw ${ZERO}`]);
    assert.equal(blobRef.code, 2, blobRef.out);
    assert.match(blobRef.out, /points at a blob/);

    const malformed = prePush(dir, ["refs/heads/main not-a-sha"]);
    assert.equal(malformed.code, 2, malformed.out);
    assert.match(malformed.out, /unexpected pre-push line/);

    writeFiles(dir, { ".git/info/grafts": `${sha}\n` });
    const grafted = prePush(dir, [`refs/heads/main ${sha} refs/heads/main ${ZERO}`]);
    assert.equal(grafted.code, 2, grafted.out);
    assert.match(grafted.out, /grafts exists/);
  } finally {
    cleanup();
  }
});

test("pre-push: a private term in a branch name is a hit", () => {
  const { dir, cleanup } = pushRepo();
  const terms = withTerms(dir, "zebrafish\n");
  try {
    const sha = git(dir, ["rev-parse", "HEAD"]);
    const { code, out } = prePush(dir, [`refs/heads/zebrafish ${sha} refs/heads/zebrafish ${ZERO}`], { SCRUB_TERMS: terms });
    assert.equal(code, 1, out);
    assert.match(out, /ref refs\/heads\/zebrafish: private term: zebrafish/);
  } finally {
    cleanup();
    rmSync(terms, { force: true });
  }
});
