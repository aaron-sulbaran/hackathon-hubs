// Processes, files, and questions for setup. Secrets only ever travel on a
// child's stdin; nothing here logs argv or stdin.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

// env is merged over process.env, or used as is with replaceEnv.
export function run(command, args, { cwd, input, env, replaceEnv = false, timeoutMs = 600000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input: input ?? "",
    encoding: "utf8",
    timeout: timeoutMs,
    env: replaceEnv ? env : env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    out: (result.stdout ?? "").trim(),
    err: (result.stderr ?? "").trim() || (result.error ? String(result.error.message) : ""),
    missing: result.error?.code === "ENOENT",
  };
}

// A child that talks to the owner directly (a browser login, a project picker).
export function runAttached(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return { ok: result.status === 0 && !result.error, status: result.status };
}

export function lastLine(text) {
  return String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "";
}

export function readJsonFile(path) {
  try {
    return { data: JSON.parse(readFileSync(path, "utf8")), error: null };
  } catch (error) {
    return { data: null, error: existsSync(path) ? `${path} is not valid JSON.` : `${path} not found.` };
  }
}

export function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

// Writes only when the bytes differ, so a second run leaves files untouched.
// The new bytes go to a temporary file with a random name in the same folder,
// opened exclusively (never an existing file or a planted link) with `mode`
// from the start, then renamed over the target. With a mode, the file is
// never visible with wider permissions, whatever the umask, and an older copy
// with wider permissions is narrowed even when its bytes are already right.
export function writeIfChanged(path, text, { mode } = {}) {
  // A private file that is a link is replaced, never followed.
  const isLink = Boolean(mode) && lstatOrNull(path)?.isSymbolicLink();
  if (!isLink && readText(path) === text) {
    if (mode && (statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(temp, "wx", mode ?? 0o666);
  try {
    // The umask can only narrow the mode openSync used; fchmod makes it exact.
    if (mode) fchmodSync(fd, mode);
    writeFileSync(fd, text);
    closeSync(fd);
    renameSync(temp, path);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {}
    rmSync(temp, { force: true });
    throw error;
  }
  if (mode) chmodSync(path, mode);
  return true;
}

export function writeJsonIfChanged(path, value, options) {
  return writeIfChanged(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listJsonFiles(path));
    else if (entry.name.endsWith(".json")) found.push(path);
  }
  return found;
}

// One readline for the whole run; its echo can be muted for secrets.
export function createAsker({ input = process.stdin, output = process.stdout } = {}) {
  let muted = false;
  let rl = null;
  let closed = false;
  const echo = new Writable({
    write(chunk, encoding, done) {
      if (!muted) output.write(chunk, encoding);
      done();
    },
  });
  // Piped answers can arrive before their question, so lines wait in a queue.
  const queued = [];
  const waiting = [];
  function open() {
    if (!rl) {
      rl = createInterface({ input, output: echo, terminal: Boolean(input.isTTY) });
      rl.on("line", (text) => {
        const next = waiting.shift();
        if (next) next(text);
        else queued.push(text);
      });
      rl.on("close", () => {
        closed = true;
        for (const next of waiting.splice(0)) next(null);
      });
    }
    return rl;
  }
  // The answer, or "" once input has ended (then `ended` is true).
  async function line(question) {
    open();
    if (question) echo.write(question);
    if (queued.length) {
      const text = queued.shift();
      if (!input.isTTY && question) output.write("\n");
      return text.trim();
    }
    if (closed) return "";
    const text = await new Promise((resolve) => waiting.push(resolve));
    if (text !== null && !input.isTTY && question) output.write("\n");

    return (text ?? "").trim();
  }
  return {
    get ended() {
      return closed && queued.length === 0;
    },
    async ask(question, fallback = "") {
      const answer = await line(fallback ? `${question} [${fallback}]: ` : `${question}: `);
      return answer === "" ? fallback : answer;
    },
    async confirm(question, defaultYes) {
      const answer = (await line(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}: `)).toLowerCase();
      if (answer === "") return defaultYes;
      return answer.startsWith("y");
    },
    async secret(question) {
      output.write(`${question}: `);
      muted = true;
      try {
        return await line("");
      } finally {
        muted = false;
        output.write("\n");
      }
    },
    close() {
      if (rl && !closed) rl.close();
    },
  };
}
