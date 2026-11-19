"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import type { WebEventInput } from "@/lib/web/event-input";
import { postEvent } from "@/lib/web/post-event";
import type { TeamPerson } from "@/lib/web/types";
import { useWho } from "./useWho";

// What every client component may need: the team (for names and accents), who
// holds this device, and one way to write an event as them.

interface HubContextValue {
  people: TeamPerson[];
  who: string | null;
  setWho: (id: string | null) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  /** Why saving from the web is off right now, or null when it works. */
  writesOff: string | null;
}

const HubContext = createContext<HubContextValue | null>(null);

export function HubProvider({ people, writesOff = null, children }: { people: TeamPerson[]; writesOff?: string | null; children: ReactNode }) {
  const [who, setWho] = useWho(people.map((person) => person.id));
  const [pickerOpen, setPickerOpen] = useState(false);
  return <HubContext.Provider value={{ people, who, setWho, pickerOpen, setPickerOpen, writesOff }}>{children}</HubContext.Provider>;
}

export function useHub(): HubContextValue {
  const value = useContext(HubContext);
  if (!value) throw new Error("useHub needs HubProvider");
  return value;
}

export type ActState = { status: "idle" } | { status: "sending" } | { status: "sent" } | { status: "error"; message: string };

/** Post an event as the current person, then re-render the page with it. Asks who you are first if nobody is chosen. */
export function useAct() {
  const { who, setPickerOpen, writesOff } = useHub();
  const router = useRouter();
  const [state, setState] = useState<ActState>({ status: "idle" });
  const [, startTransition] = useTransition();

  const act = useCallback(
    async (input: Omit<WebEventInput, "by">): Promise<boolean> => {
      if (writesOff) {
        setState({ status: "error", message: writesOff });
        return false;
      }
      if (!who) {
        setPickerOpen(true);
        setState({ status: "error", message: "Pick who you are first, then try again." });
        return false;
      }
      setState({ status: "sending" });
      const result = await postEvent({ ...input, by: who });
      if (result.error !== null) {
        setState({ status: "error", message: result.error });
        return false;
      }
      setState({ status: "sent" });
      startTransition(() => router.refresh());
      return true;
    },
    [who, router, setPickerOpen, writesOff],
  );

  return { act, state, who };
}

export function ActReceipt({ state }: { state: ActState }) {
  if (state.status === "idle") return null;
  if (state.status === "sending") return <span className="text-[12px] text-ink-2" role="status">Sending</span>;
  if (state.status === "sent") return <span className="animate-fade-in text-[12px] text-primary" role="status">Saved to the hub</span>;
  return <span className="text-[12px] font-semibold text-ink" role="alert">{state.message}</span>;
}

/** Said where a page offers to save, before anyone presses anything, while web writes are off. */
export function WritesOffNote({ className = "" }: { className?: string }) {
  const { writesOff } = useHub();
  if (!writesOff) return null;
  return (
    <p role="note" className={`flex items-start gap-2 rounded-control bg-card-flat px-3 py-2 text-[13px] leading-snug text-ink ${className}`}>
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" className="mt-px shrink-0">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--ink-2)" strokeWidth="1.75" />
        <path d="M5 15 15 5" stroke="var(--ink-2)" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      {writesOff}
    </p>
  );
}
