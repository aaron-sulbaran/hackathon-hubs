import Link from "next/link";
import { withBasePath } from "@/lib/web/base-path";
import { HeaderTabs } from "./Nav";
import { WhoButton } from "./WhoPicker";

// The 56px bar: the hub's mark and the event's name (event.name in
// hub.config.json) on the left, the four tabs in the middle from 768px, who
// holds this device on the right. To show your event's own logo, replace
// app/icon.svg.

export function Header({ eventName }: { eventName: string }) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-hairline bg-card">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-2 px-3 sm:px-4 md:grid md:grid-cols-[1fr_auto_1fr]">
        <Link href="/" className="flex min-h-11 min-w-0 items-center gap-2.5 justify-self-start rounded-control" aria-label={`${eventName} team hub, home`}>
          {/* A plain img: the file is already small, and next/image would add a route behind the gate. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath("/icon.svg")} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[10px]" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{eventName}</span>
            <span className="block truncate text-[12px] text-ink-2">Team hub</span>
          </span>
        </Link>
        <HeaderTabs />
        <div className="flex items-center justify-self-end">
          <WhoButton />
        </div>
      </div>
    </header>
  );
}
