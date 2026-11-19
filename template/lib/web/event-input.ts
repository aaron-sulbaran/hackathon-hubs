import { z } from "zod";
import { CREATING_TYPES, makeEvent, newRefId, validateEvent } from "@/lib/hub/schema.mjs";
import { SCRIPT_EDIT_TYPE, scriptEditDataSchema, scriptEditTitle } from "./pitch-script";
import { NO_ROSTER } from "./roster";
import type { HubEvent, Result } from "./types";

// What the browser may send to /api/event. The server sets id, at, and
// via: "web"; sessions and kb updates belong to agents and are refused here.

export const WEB_TYPES = [
  "item.add",
  "item.claim",
  "item.update",
  "item.block",
  "item.done",
  "note",
  "question.ask",
  "question.answer",
  "question.settle",
  "decision.propose",
  "decision.accept",
  "decision.reject",
  "gate.add",
  "gate.pass",
  "gate.fail",
  "comment",
  SCRIPT_EDIT_TYPE,
] as const;

export const webEventSchema = z.object({
  by: z.string().regex(/^[a-z][a-z0-9_]*$/, "Pick who you are first."),
  type: z.enum(WEB_TYPES),
  ref: z.string().regex(/^[tqdgs]-[a-z0-9]{4,12}$/, "Not a board id.").optional(),
  title: z.string().trim().min(1, "Say something first.").max(140, "Keep the title under 140 characters."),
  text: z.string().max(4000, "Keep it under 4000 characters.").optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type WebEventInput = z.infer<typeof webEventSchema>;

export function buildWebEvent(body: unknown, teamIds: string[], nowMs = Date.now()): Result<HubEvent> {
  const parsed = webEventSchema.safeParse(body);
  if (!parsed.success) return { data: null, error: parsed.error.issues[0]?.message ?? "Not a valid event." };
  const input = parsed.data;
  if (teamIds.length === 0) return { data: null, error: NO_ROSTER };
  if (!teamIds.includes(input.by)) return { data: null, error: `${input.by} is not on the team.` };

  // A saved line on the pitch script page: no board id, a checked data shape,
  // and a title made here so every edit reads the same in the feed.
  if (input.type === SCRIPT_EDIT_TYPE) {
    if (input.ref) return { data: null, error: "A script edit has no ref." };
    const edit = scriptEditDataSchema.safeParse(input.data ?? {});
    if (!edit.success) return { data: null, error: edit.error.issues[0]?.message ?? "Not a valid script edit." };
    const data = { ...edit.data, text: edit.data.text.trim() };
    const title = scriptEditTitle(data.cue, data.field, data.text, data.revert === true);
    const made = makeEvent({ by: input.by, via: "web", type: SCRIPT_EDIT_TYPE, title, data, now: nowMs });
    if (!made.data) return { data: null, error: made.error ?? "Not a valid event." };
    const checked = validateEvent(made.data, { teamIds });
    if (!checked.ok) return { data: null, error: checked.reason };
    return { data: checked.event as HubEvent, error: null };
  }

  const createdPrefix = (CREATING_TYPES as Record<string, string>)[input.type];
  const ref = createdPrefix ? newRefId(createdPrefix as "t" | "q" | "d" | "g" | "s") : input.ref;
  if (!createdPrefix && !ref) return { data: null, error: `${input.type} needs a ref.` };

  const made = makeEvent({ by: input.by, via: "web", type: input.type, ref, title: input.title, text: input.text, data: input.data ?? {}, now: nowMs });
  if (!made.data) return { data: null, error: made.error ?? "Not a valid event." };
  const checked = validateEvent(made.data, { teamIds });
  if (!checked.ok) return { data: null, error: checked.reason };
  return { data: checked.event as HubEvent, error: null };
}
