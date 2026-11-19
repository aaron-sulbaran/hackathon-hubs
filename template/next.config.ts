import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { CONFIG_FILE, defaultConfig, loadConfig } from "./lib/hub/config.mjs";

// The event's settings come from this folder's hub.config.json, read here at
// build time (and again by `next start`): Next needs the base path before
// anything runs, and every clock on the board formats in the event's zone.
// Changing either needs a rebuild (a redeploy); see docs/deploy.md.
//
// Only this folder's file counts, never HUB_LOCAL_DIR's: the base path the
// proxy was built for must be the base path the server runs under. A file
// that exists but does not check out stops the build with the reason, rather
// than building a board at the wrong path or in the wrong zone. A hub nobody
// has set up yet (no file) builds with the defaults.
// next build and next start run in the app folder.
const appDir = process.cwd();
const configPath = path.join(appDir, CONFIG_FILE);
const loaded = loadConfig(appDir);
if (loaded.error && existsSync(configPath)) {
  throw new Error(`Cannot build the board: ${loaded.error} Fix ${CONFIG_FILE} (./hub doctor checks it), then build again.`);
}
const config = loaded.data ?? defaultConfig();
const basePath: string = config.hub.basePath;

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  poweredByHeader: false,
  env: {
    HUB_BASE_PATH: basePath,
    HUB_TIME_ZONE: config.event.timezone,
    // A fallback only: HUB_REPO on the deployment wins (lib/web/source.ts).
    HUB_CONFIG_REPO: config.hub.repo,
    // What the board shows when the hub.config.json it reads with the data
    // is missing or broken (lib/web/event-config.ts). Read by server code only.
    HUB_BUILD_CONFIG: JSON.stringify(config),
  },
  // Until a token is set, production reads events and kb from the deployment
  // itself, so they ship in the bundle. With a token set the board reads the
  // repo tarball instead and these copies are ignored.
  outputFileTracingIncludes: { "*": ["events/**/*.json", "kb/**/*.md", "team.json", "hub.config.json", "docs/agent-prompt.md"] },
  outputFileTracingExcludes: { "*": ["sources/**", "tests/**"] },
  async headers() {
    // basePath: false so the headers cover every path this deployment answers,
    // inside the base path or not. no-referrer: a board page never tells
    // another site its address, and the unlock link (whose query string holds
    // the key) never leaks through a Referer header.
    return [
      {
        source: "/:path*",
        basePath: false,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
