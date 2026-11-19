import { gunzipSync } from "node:zlib";

// Just enough of the tar format to read a GitHub repository tarball in memory:
// ustar headers, pax extended headers (GitHub uses them for long paths and for
// the global commit comment), and GNU long names. Every path loses its first
// segment, which is GitHub's "<owner>-<repo>-<sha>/" wrapper folder.

const BLOCK = 512;

function readString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(buffer: Buffer, start: number, length: number): number {
  const text = readString(buffer, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(body: Buffer): Record<string, string> {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(0x20, offset);
    if (space === -1) break;
    const length = parseInt(body.subarray(offset, space).toString("utf8"), 10);
    if (!length) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
}

function stripWrapper(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(slash + 1);
}

/**
 * Regular files from a tar (gzipped or not) whose wrapper-stripped path passes `keep`.
 */
export function extractTar(archive: Buffer, keep: (path: string) => boolean): Map<string, string> {
  const tar = archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive) : archive;
  const files = new Map<string, string>();
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const bodyStart = offset + BLOCK;
    const body = tar.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeFlag === "x") {
      paxPath = parsePax(body).path ?? null;
      continue;
    }
    if (typeFlag === "g") continue;
    if (typeFlag === "L") {
      longName = readString(body, 0, body.length);
      continue;
    }

    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const fullPath = paxPath ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    longName = null;

    if (typeFlag !== "0" && typeFlag !== "\0") continue;
    const path = stripWrapper(fullPath);
    if (path && keep(path)) files.set(path, body.toString("utf8"));
  }
  return files;
}
