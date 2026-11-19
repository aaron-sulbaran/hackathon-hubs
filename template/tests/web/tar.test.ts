import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractTar } from "@/lib/web/tar";

function header(name: string, size: number, type: string): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, "utf8");
  block.write(size.toString(8).padStart(11, "0"), 124, "ascii");
  block.write(type, 156, "ascii");
  block.write("ustar", 257, "ascii");
  return block;
}

function entry(name: string, body: string, type = "0"): Buffer {
  const content = Buffer.from(body, "utf8");
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
  content.copy(padded);
  return Buffer.concat([header(name, content.length, type), padded]);
}

function pax(path: string): Buffer {
  const record = (text: string) => {
    let length = text.length + 3;
    while (`${length} ${text}\n`.length !== length) length += 1;
    return `${length} ${text}\n`;
  };
  return entry("pax", record(`path=${path}`), "x");
}

describe("extractTar", () => {
  const longPath = `owner-repo-abc123/events/2027-01-14/${"1799902800000-ada-k3x9".padEnd(110, "x")}.json`;
  const archive = gzipSync(
    Buffer.concat([
      entry("pax_global_header", "52 comment=abc123\n", "g"),
      entry("owner-repo-abc123/", "", "5"),
      entry("owner-repo-abc123/team.json", '{"people":[]}'),
      entry("owner-repo-abc123/kb/prompt.md", "# Prompt"),
      entry("owner-repo-abc123/app/page.tsx", "skip me"),
      pax(longPath),
      entry("ignored-short-name", '{"v":1}'),
      Buffer.alloc(1024),
    ]),
  );

  it("strips the wrapper folder and keeps only wanted files", () => {
    const files = extractTar(archive, (path) => !path.startsWith("app/"));
    expect(files.get("team.json")).toBe('{"people":[]}');
    expect(files.get("kb/prompt.md")).toBe("# Prompt");
    expect(files.has("app/page.tsx")).toBe(false);
  });

  it("uses pax paths for long names", () => {
    const files = extractTar(archive, () => true);
    expect(files.get(longPath.slice(longPath.indexOf("/") + 1))).toBe('{"v":1}');
  });
});
