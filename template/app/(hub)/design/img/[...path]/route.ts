import { hiddenResponse, requestAllowed } from "@/lib/web/gate";
import { readFile } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { designImagePath, imageContentType } from "@/lib/web/design-reviews";
import { realFileInside } from "@/lib/web/disk-path";
import { hubRepo, localRoot, readsFromDisk, readToken } from "@/lib/web/source";

// One design image from the hub repo, for the Design page. Only paths under
// design/review, design/reference, or design/mockups with an image extension
// are served; anything else is the same bare 404 the gate in proxy.ts gives.
// proxy.ts covers this route too, so an image needs the unlock cookie.
// The cache header is private: the board may sit behind another site's CDN,
// which must never keep a copy.

export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

async function readImage(repoPath: string): Promise<ArrayBuffer | null> {
  if (readsFromDisk()) {
    // designImagePath already allowed only design/<folder>/<name>; this also
    // follows symlinks, so a link planted at an allowed name cannot reach outside.
    const folder = repoPath.split("/").slice(0, 2).join("/");
    const file = await realFileInside(localRoot(), folder, repoPath);
    if (!file) return null;
    const bytes = await readFile(/* turbopackIgnore: true */ file).catch(() => null);
    return bytes ? new Uint8Array(bytes).buffer : null;
  }
  const repo = hubRepo();
  const token = readToken();
  if (!repo || !token) return null;
  const encoded = repoPath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encoded}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.arrayBuffer();
}

export async function GET(request: NextRequest, context: RouteContext<"/design/img/[...path]">) {
  if (!(await requestAllowed(request))) return hiddenResponse();
  const { path: segments } = await context.params;
  const repoPath = designImagePath(`design/${segments.join("/")}`);
  if (!repoPath) return notFound();
  const bytes = await readImage(repoPath).catch(() => null);
  if (!bytes) return notFound();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": imageContentType(repoPath),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
