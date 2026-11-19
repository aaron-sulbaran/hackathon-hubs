"use client";

import { useEffect, useRef } from "react";
import { firstName } from "@/lib/web/people";
import { Avatar } from "./Avatar";
import { useHub } from "./HubContext";
import { useHydrated } from "./useWho";

// The header button that says who holds this device, and the small menu that
// changes it. Everything written from the web is signed with this choice.

export function WhoButton() {
  const { people, who, pickerOpen, setPickerOpen } = useHub();
  const hydrated = useHydrated();
  const person = people.find((candidate) => candidate.id === who);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [pickerOpen, setPickerOpen]);

  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        onClick={() => setPickerOpen(!pickerOpen)}
        aria-expanded={pickerOpen}
        aria-haspopup="menu"
        className="flex h-10 items-center gap-2 rounded-full bg-button-2 py-1 pr-3 pl-1 text-[15px] font-semibold text-ink transition-colors hover:brightness-95"
      >
        {hydrated && person ? (
          <>
            <Avatar id={person.id} name={person.name} size={32} />
            <span className="max-sm:hidden">{firstName(person.name)}</span>
          </>
        ) : (
          <span className="pl-2">Who are you?</span>
        )}
      </button>
      {pickerOpen && <WhoMenu />}
    </div>
  );
}

function WhoMenu() {
  const { people, who, setWho, setPickerOpen } = useHub();
  return (
    <div
      role="menu"
      className="absolute top-12 right-0 z-50 w-64 animate-sheet-up rounded-card bg-card p-2 shadow-float"
    >
      <p className="px-2 pt-1 pb-2 text-[13px] text-ink-2">Web writes are signed with this name.</p>
      {people.map((person) => (
        <button
          key={person.id}
          role="menuitemradio"
          aria-checked={who === person.id}
          type="button"
          onClick={() => {
            setWho(person.id);
            setPickerOpen(false);
          }}
          className={`flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left text-[15px] hover:bg-hover ${who === person.id ? "bg-tint" : ""}`}
        >
          <Avatar id={person.id} name={person.name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">{person.name}</span>
            {person.school && <span className="block text-[12px] text-ink-2">{person.school}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The first-visit card that leads the home page while nobody is picked: one tap to say who you are. */
export function WhoPrompt() {
  const { people, who, setWho } = useHub();
  const hydrated = useHydrated();
  if (!hydrated || who) return null;
  return (
    <section aria-labelledby="who-prompt-heading" className="animate-card-in rounded-card bg-card p-4 shadow-card outline-2 -outline-offset-2 outline-primary sm:p-5">
      <h2 id="who-prompt-heading" className="text-[20px] leading-tight font-semibold text-ink">
        Welcome. Who are you?
      </h2>
      <p className="mt-1 text-[15px] leading-snug text-ink-2">Pick yourself once on this device. It signs what you do here and shows your first task.</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => setWho(person.id)}
              className="flex w-full items-center gap-3 rounded-card bg-card-flat p-2.5 text-left transition-colors hover:bg-hover"
            >
              <Avatar id={person.id} name={person.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-ink">{person.name}</span>
                {person.school && <span className="block truncate text-[12px] text-ink-2">{person.school}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
