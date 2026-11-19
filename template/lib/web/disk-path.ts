import "server-only";
import { realpath } from "node:fs/promises";
import path from "node:path";

function isInside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
}

/**
 * The real path of `relative` under `root`, or null unless it is a file that
 * stays inside `root/allowedDir` after every symlink is followed. Containment
 * is anchored to the canonical hub root: the allowed folder must itself sit
 * inside the real root, and the file inside the real allowed folder. So a file
 * link leading out (design/review/x.png to team.json, or outside the hub) is
 * refused, and so is an allowed folder that is itself a link outside the hub.
 * Never throws; anything missing or unreadable is null.
 */
export async function realFileInside(root: string, allowedDir: string, relative: string): Promise<string | null> {
  const realRoot = await realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ root)).catch(() => null);
  if (!realRoot) return null;
  const realDir = await realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ realRoot, allowedDir)).catch(() => null);
  if (!realDir || !isInside(realRoot, realDir)) return null;
  const realFile = await realpath(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ realRoot, relative)).catch(() => null);
  if (!realFile || !isInside(realDir, realFile)) return null;
  return realFile;
}
