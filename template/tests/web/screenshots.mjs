// Screenshots of the main views at phone and desktop width, light and dark.
// Usage: node tests/web/screenshots.mjs <base-url> <out-dir>
// The base url includes the base path; by default it is localhost:3000 plus hub.basePath
// from hub.config.json (HUB_LOCAL_DIR's when set). If HUB_KEY is set, the unlock link is opened first.
// HUB_SHOT_WHO picks the teammate holding the device (default ada; "none" for a first visit).
// HUB_SHOT_PAGES narrows the views, by name, comma separated (for example "home").
// HUB_SHOT_SCHEMES narrows the color schemes (for example "light").
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { configOrDefault } from "../../lib/hub/config.mjs";

const basePath = configOrDefault(resolve(process.env.HUB_LOCAL_DIR || process.cwd())).hub.basePath;
const [, , base = `http://localhost:3000${basePath}`, outDir = "shots"] = process.argv;
mkdirSync(outDir, { recursive: true });

const who = process.env.HUB_SHOT_WHO ?? "ada";
const onlyPages = process.env.HUB_SHOT_PAGES?.split(",").map((name) => name.trim());
const schemes = process.env.HUB_SHOT_SCHEMES?.split(",").map((name) => name.trim()) ?? ["light", "dark"];
const suffix = process.env.HUB_SHOT_WHO ? `-${who}` : "";

const allPages = [
  ["home", ""],
  ["board", "/board"],
  ["board-sheet", "/board?item=t-hub1"],
  ["decide", "/decide"],
  ["person", "/p/ada"],
  ["calendar", "/calendar"],
  ["knowledge", "/kb"],
  ["kb-page", "/kb/index"],
];
const pages = onlyPages ? allPages.filter(([name]) => onlyPages.includes(name)) : allPages;
const widths = [
  ["390", { width: 390, height: 844 }],
  ["1440", { width: 1440, height: 900 }],
];

// The full Chromium build in new headless mode; no separate headless shell download needed.
const browser = await chromium.launch({ channel: "chromium" });
try {
  for (const scheme of schemes) {
    for (const [label, viewport] of widths) {
      const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
      if (who !== "none") await context.addInitScript((id) => window.localStorage.setItem("hub-who", id), who);
      const page = await context.newPage();
      if (process.env.HUB_KEY) await page.goto(`${base}/unlock?key=${encodeURIComponent(process.env.HUB_KEY)}`, { waitUntil: "networkidle" });
      for (const [name, path] of pages) {
        await page.goto(base + path, { waitUntil: "networkidle" });
        // Long enough for the map's swarm entrance to settle.
        await page.waitForTimeout(1800);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) console.log(`OVERFLOW ${overflow}px: ${name} ${label} ${scheme}`);
        await page.screenshot({ path: `${outDir}/${name}${suffix}-${label}-${scheme}.png`, fullPage: !name.includes("sheet") });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log("done");
