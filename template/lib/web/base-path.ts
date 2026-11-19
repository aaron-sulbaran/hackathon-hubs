// The board can be served at the root of its own domain (hub.basePath "", the
// default) or mounted under a path on another site (hub.basePath "/hub").
// next.config.ts reads hub.config.json and hands the value to every bundle as
// HUB_BASE_PATH, and sets it as Next's basePath, so <Link>, the router, and
// Next's own assets get it for free. Anything Next does not prefix (fetch,
// plain <a> and <img>, cookie Path, redirect Location) must go through
// withBasePath.

function readBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return /^(\/[a-z0-9][a-z0-9-]*)*$/.test(trimmed) ? trimmed : "";
}

export const BASE_PATH = readBasePath(process.env.HUB_BASE_PATH);

/** Join a base path ("" or "/hub") and an app path ("/", "/board?item=x", "/#s-ab12"). Exported for tests. */
export function joinBasePath(base: string, path: string): string {
  const appPath = path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  if (!base) return appPath;
  if (appPath === "/") return base;
  if (appPath.startsWith("/#") || appPath.startsWith("/?")) return `${base}${appPath.slice(1)}`;
  return `${base}${appPath}`;
}

/** Prefix an app path ("/", "/board?item=x", "/brand/logo.png") with the base path. */
export function withBasePath(path: string): string {
  return joinBasePath(BASE_PATH, path);
}

/** The path a cookie or redirect should name for the whole app: the base path, or "/" when there is none. */
export const APP_ROOT = BASE_PATH || "/";
