import { describe, expect, it } from "vitest";
import { buildClockEvent, clockFromEvent, latestClock, newerClock, type ClockState } from "@/lib/web/pitch-clock";

const ids = ["ada", "grace"];
const NOW = Date.parse("2027-01-15T18:10:00Z");

function state(overrides: Partial<ClockState> = {}): ClockState {
  return { action: "start", running: true, base: 0, atMs: NOW, current: 0, partStart: 0, splits: [], ...overrides };
}

describe("buildClockEvent", () => {
  it("turns a press into a script.clock event with a readable title", () => {
    const built = buildClockEvent({ by: "ada", state: state() }, ids, NOW);
    expect(built.error).toBeNull();
    expect(built.data?.type).toBe("script.clock");
    expect(built.data?.title).toBe("Pitch clock started");
    expect(built.data?.via).toBe("web");
    const paused = buildClockEvent({ by: "ada", state: state({ action: "pause", running: false, base: 83 }) }, ids, NOW);
    expect(paused.data?.title).toBe("Pitch clock paused at 1:23");
    const ended = buildClockEvent({ by: "ada", state: state({ action: "next", running: true, base: 47, current: 1, partStart: 47, splits: [47] }) }, ids, NOW);
    expect(ended.data?.title).toBe("Pitch clock: part 1 ended at 0:47");
  });

  it("takes the server's time when the phone's clock is far off", () => {
    const built = buildClockEvent({ by: "grace", state: state({ atMs: NOW - 60_000 }) }, ids, NOW);
    expect((built.data?.data as ClockState).atMs).toBe(NOW);
    const close = buildClockEvent({ by: "grace", state: state({ atMs: NOW - 2_000 }) }, ids, NOW);
    expect((close.data?.data as ClockState).atMs).toBe(NOW - 2_000);
  });

  it("refuses someone off the team, a missing picker, and a malformed state", () => {
    expect(buildClockEvent({ by: "zed", state: state() }, ids, NOW).error).toMatch(/not on the team/);
    expect(buildClockEvent({ state: state() }, ids, NOW).error).not.toBeNull();
    expect(buildClockEvent({ by: "ada", state: { ...state(), base: -1 } }, ids, NOW).error).not.toBeNull();
    expect(buildClockEvent({ by: "ada", state: { ...state(), extra: true } }, ids, NOW).error).not.toBeNull();
  });
});

describe("latestClock", () => {
  it("picks the newest state by when it was taken, and skips other events", () => {
    const first = buildClockEvent({ by: "ada", state: state({ atMs: NOW - 5_000 }) }, ids, NOW).data;
    const second = buildClockEvent({ by: "grace", state: state({ action: "pause", running: false, base: 5, atMs: NOW }) }, ids, NOW).data;
    const latest = latestClock([second, { type: "note", by: "ada", data: {} }, first, null]);
    expect(latest?.by).toBe("grace");
    expect(latest?.state.action).toBe("pause");
    expect(clockFromEvent({ type: "script.clock", by: "ada", data: { running: "yes" } })).toBeNull();
    expect(newerClock(null, null)).toBeNull();
  });
});
