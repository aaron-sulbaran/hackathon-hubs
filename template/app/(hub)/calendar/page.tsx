import { CalendarView } from "@/components/CalendarView";
import { zoneLong } from "@/lib/web/format";
import { getHub } from "@/lib/web/get-hub";

export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const { agenda, nowIso, config } = await getHub();
  // Name the zone as it is during the event (summer or standard time), not today.
  const eventMs = Date.parse(config.event.startsAt || config.event.submitBy) || agenda[0]?.startMs || Date.parse(nowIso);
  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-4 px-3 pt-4 sm:px-4">
      <div className="px-1">
        <h1 className="text-[24px] font-semibold text-ink">Schedule</h1>
        <p className="text-[15px] text-ink-2">Every time is {zoneLong(eventMs)}. Filled diamonds are deadlines, outlined diamonds are checkpoints.</p>
      </div>
      <CalendarView agenda={agenda} nowIso={nowIso} />
    </main>
  );
}
