import { withBasePath } from "./base-path";
import type { HubEvent } from "./types";
import type { WebEventInput } from "./event-input";

// Browser side of the one write endpoint.
export async function postEvent(input: WebEventInput): Promise<{ data: HubEvent; error: null } | { data: null; error: string }> {
  try {
    const response = await fetch(withBasePath("/api/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as { event?: HubEvent; error?: string } | null;
    if (response.ok && body?.event) return { data: body.event, error: null };
    return { data: null, error: body?.error ?? `The server said ${response.status}.` };
  } catch {
    return { data: null, error: "No connection. Try again in a moment." };
  }
}
