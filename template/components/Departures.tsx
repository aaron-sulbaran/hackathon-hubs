"use client";

import { countdownParts, formatCountdown, formatStamp, zoneShort } from "@/lib/web/format";
import { finalDeadline, hackingStart, type AgendaEntry } from "@/lib/web/playbook";
import { PlaneIcon } from "./icons";
import { StatusGlyph } from "./StatusGlyph";
import { useNow } from "./useNow";

// The departures board: time left to the submission deadline, how much of the
// hacking time is gone (the plane sits at that point on the route), and the
// deadlines around now as board rows. Everything comes from kb/playbook.md.

// On the navy board the done check is drawn in the board's own ink.
const ON_BOARD = { "--primary": "var(--board-ink)", "--on-primary": "var(--board)" } as React.CSSProperties;

/** "Due (two documents disagree)" reads as the title, then the note as its own sentence. */
function splitNote(title: string): { title: string; note: string | null } {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(title);
  if (!match?.[1] || !match[2]) return { title, note: null };
  const note = match[2].trim();
  return { title: match[1], note: `${note.charAt(0).toUpperCase()}${note.slice(1)}${/[.!?]$/.test(note) ? "" : "."}` };
}

function Digits({ value, unit, label }: { value: number; unit: string; label: string }) {
  const text = String(value).padStart(2, "0");
  return (
    <span className="flex items-end gap-1" aria-label={`${value} ${label}`}>
      {[...text].map((digit, i) => (
        <span
          key={`${i}-${digit}`}
          aria-hidden="true"
          className="flex h-[52px] w-[38px] animate-flap items-center justify-center rounded-[6px] bg-board-tile font-[family-name:var(--font-doto)] text-[40px] leading-none font-black text-board-tile-ink tabular-nums sm:h-[58px] sm:w-[42px] sm:text-[44px]"
        >
          {digit}
        </span>
      ))}
      <span aria-hidden="true" className="pb-1 pl-0.5 text-[15px] font-medium text-board-ink-2">
        {unit}
      </span>
    </span>
  );
}

export function Departures({ agenda, nowIso }: { agenda: AgendaEntry[]; nowIso: string }) {
  const target = finalDeadline(agenda);
  const start = hackingStart(agenda);
  const nowMs = useNow(nowIso, Boolean(target && target.startMs - Date.parse(nowIso) < 2 * 3600 * 1000));

  if (!target) {
    return (
      <section aria-label="Time left" className="rounded-card bg-board p-5 text-board-ink" style={ON_BOARD}>
        <h2 className="text-[17px] font-semibold">Time left</h2>
        <p className="mt-1 text-[13px] text-board-ink-2">No deadlines yet. They come from the Deadlines section of kb/playbook.md.</p>
      </section>
    );
  }

  const heading = splitNote(target.title);
  const parts = countdownParts(target.startMs, nowMs);
  const totalHours = parts ? parts.days * 24 + parts.hours : 0;
  const lastHour = parts !== null && totalHours === 0;
  const progress = start ? Math.min(1, Math.max(0, (nowMs - start.startMs) / (target.startMs - start.startMs))) : null;
  const deadlines = agenda.filter((entry) => entry.point);
  const lastPassed = [...deadlines].reverse().find((entry) => entry.startMs <= nowMs);
  const rows = [...(lastPassed ? [lastPassed] : []), ...deadlines.filter((entry) => entry.startMs > nowMs)].slice(0, 3);

  return (
    <section aria-labelledby="departures-heading" className="overflow-hidden rounded-card bg-board text-board-ink shadow-card" style={ON_BOARD}>
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="departures-heading" className="text-[15px] font-medium text-board-ink-2">
          {parts ? "Time left to submit" : "Submissions closed"}
        </h2>
        {parts ? (
          <div className="mt-2 flex items-end gap-3" role="timer" aria-live="off">
            {lastHour ? (
              <>
                <Digits value={parts.minutes} unit="m" label="minutes" />
                <Digits value={parts.seconds} unit="s" label="seconds" />
              </>
            ) : (
              <>
                <Digits value={totalHours} unit="h" label="hours" />
                <Digits value={parts.minutes} unit="m" label="minutes" />
              </>
            )}
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-[22px] font-semibold">
            <StatusGlyph status="done" size={22} label="Passed" />
            {formatStamp(target.startMs)}
          </p>
        )}
        <p className="mt-2 text-[15px] leading-snug font-semibold">{heading.title}</p>
        <p className="text-[13px] text-board-ink-2">
          {formatStamp(target.startMs)} {zoneShort(target.startMs)}{heading.note ? `. ${heading.note}` : ""}
        </p>
      </div>

      {progress !== null && start && (
        <div className="px-4 pt-4 sm:px-5">
          <div className="relative h-6" role="img" aria-label={`${Math.round(progress * 100)} percent of the hacking time is gone`}>
            <svg className="absolute inset-x-0 top-1/2 h-2 w-full -translate-y-1/2 overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 2" aria-hidden="true">
              <line x1="0" y1="1" x2="100" y2="1" stroke="var(--board-ink-2)" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="1" x2={progress * 100} y2="1" stroke="var(--board-ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-board-ink" style={{ left: `${progress * 100}%` }} aria-hidden="true">
              <PlaneIcon size={22} />
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-3 text-[12px] text-board-ink-2">
            <span>Began {formatStamp(start.startMs)}</span>
            <span className="tabular-nums">{Math.round(progress * 100)}% of hacking time gone</span>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <ol className="mt-4 border-t border-board-rule" aria-label="Deadlines">
          {rows.map((entry) => {
            const passed = entry.startMs <= nowMs;
            const left = formatCountdown(entry.startMs, nowMs);
            return (
              <li key={entry.id} className={`grid grid-cols-[84px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-board-rule px-4 py-2.5 last:border-b-0 sm:px-5 ${passed ? "text-board-ink-2" : ""}`}>
                <span className="text-[13px] tabular-nums">{formatStamp(entry.startMs)}</span>
                <span className="min-w-0 text-[14px] leading-snug">
                  {entry.title}
                  {entry.where && <span className="text-board-ink-2"> · {entry.where}</span>}
                </span>
                <span className="flex items-center gap-1.5 text-[13px] whitespace-nowrap tabular-nums">
                  {passed ? (
                    <>
                      <StatusGlyph status="done" size={15} label="Passed" />
                      Departed
                    </>
                  ) : (
                    `in ${left}`
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
