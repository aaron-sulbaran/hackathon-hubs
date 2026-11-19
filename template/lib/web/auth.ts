// The whole board sits behind one unlock link: /unlock?key=<HUB_KEY> sets a
// signed cookie, and every other request needs it. The cookie is
// "<expiry ms>.<HMAC of the payload and that expiry under HUB_KEY>", so the
// server refuses it after 14 days even if a browser keeps it, and rotating
// HUB_KEY signs everyone out at once. With HUB_KEY unset in development the
// board stays open; in production it serves nothing.

export const SESSION_COOKIE = "hub_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;
const PAYLOAD = "hackathon-hub:v2";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function mac(secret: string, expiresAtMs: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${PAYLOAD}:${expiresAtMs}`)));
}

/** A cookie value good until nowMs plus SESSION_MAX_AGE. */
export async function signSession(secret: string, nowMs = Date.now()): Promise<string> {
  const expiresAtMs = nowMs + SESSION_MAX_AGE * 1000;
  return `${expiresAtMs}.${await mac(secret, expiresAtMs)}`;
}

export async function verifySession(cookie: string | undefined, secret: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !cookie) return false;
  const match = /^(\d{13})\.([0-9a-f]{64})$/.exec(cookie);
  if (!match?.[1] || !match[2]) return false;
  const expiresAtMs = Number(match[1]);
  // The signature is checked even for an expired cookie, so timing says nothing about which part failed.
  const valid = timingSafeEqual(match[2], await mac(secret, expiresAtMs));
  return valid && expiresAtMs > nowMs && expiresAtMs <= nowMs + SESSION_MAX_AGE * 1000;
}

export function keyMatches(given: string | null, secret: string | undefined): boolean {
  if (!secret || !given) return false;
  return timingSafeEqual(given, secret);
}

export type GateMode = "open" | "locked" | "closed";

/** open: no key and not production; locked: a key is set; closed: production without a key, so nothing is served. */
export function gateMode(secret: string | undefined, nodeEnv: string | undefined): GateMode {
  if (secret) return "locked";
  return nodeEnv === "production" ? "closed" : "open";
}
