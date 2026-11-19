"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { BoardIcon, GraphIcon, HomeIcon, RouteIcon } from "./icons";

// Four places. Decide and Design stay reachable from the links that need them
// (a question in "Needs you", a design review row) but are not tabs: they are
// visited rarely and from those links, and every tab costs attention.
export const NAV: Array<{ href: string; label: string; Icon: ComponentType<{ size?: number }> }> = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/board", label: "Board", Icon: BoardIcon },
  { href: "/calendar", label: "Schedule", Icon: RouteIcon },
  { href: "/kb", label: "Knowledge", Icon: GraphIcon },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Labeled tabs in the header from 768px: the current one sits in a sky pill. */
export function HeaderTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-[15px] transition-colors lg:px-4 ${
              active ? "bg-tint font-semibold text-ink" : "font-medium text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            <Icon size={19} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** At phone width the same four tabs sit in a bar at the bottom; the current icon gets the pill. */
export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 pt-2 pb-2 text-[12px] ${active ? "font-semibold text-ink" : "font-medium text-ink-2"}`}
          >
            <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-tint" : ""}`}>
              <Icon size={22} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
