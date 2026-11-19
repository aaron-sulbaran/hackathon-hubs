import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BottomTabs } from "@/components/Nav";
import { Header } from "@/components/Header";
import { HubProvider } from "@/components/HubContext";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SESSION_COOKIE } from "@/lib/web/auth";
import { sessionAllows } from "@/lib/web/gate";
import { getHub } from "@/lib/web/get-hub";
import { accentCss } from "@/lib/web/people";

// Every page that shows team data lives under this layout. It checks the
// unlock cookie itself (proxy.ts checked it already) before it loads the hub,
// so no page here renders for a visitor without the cookie, whatever the
// proxy did. A refused visitor gets the root 404, which names nothing.

async function allowed(): Promise<boolean> {
  return sessionAllows((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  if (!(await allowed())) return {};
  const { config } = await getHub();
  return {
    title: `${config.event.name} hub`,
    description: `Private team board for ${config.event.name}.`,
  };
}

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  if (!(await allowed())) notFound();
  const { board, writesOff, config } = await getHub();
  const people = board.people.map(({ id, name, school, focus, github }) => ({ id, name, school, focus, github }));
  return (
    <HubProvider people={people} writesOff={writesOff}>
      {/* Each person's color, by their place in team.json (lib/web/people.ts). */}
      <style>{accentCss(board.people.map((person) => person.id))}</style>
      <Header eventName={config.event.name} />
      <div className="pb-20 md:pb-8">{children}</div>
      <BottomTabs />
      <LiveRefresh />
    </HubProvider>
  );
}
