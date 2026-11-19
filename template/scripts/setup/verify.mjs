// Proves a deploy works from the outside, the way a teammate meets it: open the
// unlock link, keep the cookie, load the home page. Error text never includes
// the link, because the link holds the key.

export const SESSION_COOKIE = "hub_session";

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function setCookies(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const joined = response.headers.get("set-cookie");
  return joined ? [joined] : [];
}

function describe(response) {
  const location = response.headers.get("location") ?? "";
  if ((response.status === 401 || response.status === 403) || /vercel\.com\/(sso|login)/.test(location)) {
    return `${response.status}: Vercel Deployment Protection is asking for a Vercel login. Turn it off for production, or use the production domain with --board-url.`;
  }
  if (response.status === 404) return "404: the board does not know this key yet. HUB_KEY may not have reached this deployment; redeploy with ./hub setup --deploy.";
  return `HTTP ${response.status}`;
}

async function checkOnce(boardUrl, basePath, key, fetchImpl) {
  const origin = boardUrl.replace(/\/+$/, "");
  const unlock = await fetchImpl(`${origin}${basePath}/unlock?key=${encodeURIComponent(key)}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const toVercelLogin = /vercel\.com\/(sso|login)/.test(unlock.headers.get("location") ?? "");
  if (unlock.status < 300 || unlock.status >= 400 || toVercelLogin) return { ok: false, step: "unlock link", detail: describe(unlock) };
  const session = setCookies(unlock).map((cookie) => cookie.split(";")[0]).find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
  if (!session) return { ok: false, step: "unlock link", detail: `redirected (HTTP ${unlock.status}) but set no ${SESSION_COOKIE} cookie` };
  const home = await fetchImpl(`${origin}${basePath || "/"}`, {
    headers: { cookie: session },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (home.status !== 200) return { ok: false, step: "home page", detail: describe(home) };
  return { ok: true, step: "home page", detail: "unlock link works and the home page loads" };
}

// A fresh production alias can take a few seconds to answer, so try a few times.
export async function verifyBoard(boardUrl, basePath, key, { fetchImpl = fetch, attempts = 4, waitMs = 4000 } = {}) {
  let last = { ok: false, step: "unlock link", detail: "not tried" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      last = await checkOnce(boardUrl, basePath, key, fetchImpl);
    } catch (error) {
      last = { ok: false, step: "unlock link", detail: `could not connect (${error?.cause?.code ?? error?.name ?? "network error"})` };
    }
    if (last.ok) return last;
    if (attempt < attempts) await sleep(waitMs);
  }
  return last;
}
