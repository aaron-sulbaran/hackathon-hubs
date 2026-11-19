import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/Card";
import { CopyForAI } from "@/components/CopyForAI";
import { formatDateOnly } from "@/lib/web/format";
import { getHub } from "@/lib/web/get-hub";
import { buildGraph, GROUPS, neighborsOf } from "@/lib/web/graph";
import { renderMarkdown } from "@/lib/web/markdown";
import { firstName } from "@/lib/web/people";

export const dynamic = "force-dynamic";

export default async function KbPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug: parts } = await params;
  const slug = parts.map(decodeURIComponent).join("/");
  const { board, pages, repo, config } = await getHub();
  const page = pages.find((candidate) => candidate.slug === slug);
  if (!page) notFound();
  const peopleIds = board.people.map((person) => person.id);
  const titles = Object.fromEntries(pages.map((candidate) => [candidate.slug, candidate.title]));
  const html = renderMarkdown(page.body, { peopleIds, repo, titles });
  const graph = buildGraph(board, pages);
  const linked = [...neighborsOf(`kb/${slug}`, graph.edges)].map((id) => graph.nodes.find((node) => node.id === id)).filter((node) => node !== undefined);
  const author = board.people.find((person) => person.id === page.by);
  const group = GROUPS.find((candidate) => candidate.id === graph.nodes.find((node) => node.id === `kb/${slug}`)?.group);
  const brief = [
    `From our ${config.event.name} team hub${repo ? ` (${repo})` : ""}, page kb/${slug}.md${page.updated ? `, updated ${page.updated}` : ""}${author ? ` by ${author.name.split(" ")[0]}` : ""}. Use it as context; link it as [[kb/${slug}]] in hub notes.`,
    "",
    `# ${page.title}`,
    "",
    page.body.replace(/^#\s+.+\n+/, "").trim(),
  ].join("\n");

  return (
    <main className="mx-auto grid max-w-[1100px] grid-cols-1 gap-4 px-2 pt-4 sm:px-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="pt-3 text-[13px] text-ink-2">
          <Link href="/kb" className="font-semibold text-link hover:underline">
            Knowledge
          </Link>
          {group ? ` · ${group.label}` : ""}
          {page.updated ? ` · updated ${formatDateOnly(page.updated)}` : ""}
          {author ? ` by ${firstName(author.name)}` : page.by ? ` by ${page.by}` : ""}
        </p>
        <CopyForAI text={brief} />
        </div>
        <article className="prose-hub mt-2 text-[15px] text-ink" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
      <aside className="flex flex-col gap-4 self-start">
        <Card>
          <h2 className="px-4 pt-3 pb-1 text-[17px] font-semibold text-ink">Linked</h2>
          {linked.length === 0 ? (
            <p className="px-4 pb-3 text-[13px] text-ink-2">Nothing links here yet. Mention it as [[kb/{slug}]] in a page or an event.</p>
          ) : (
            <ul className="px-2 pb-2">
              {linked.map((node) => (
                <li key={node.id}>
                  <Link href={node.href} className="block truncate rounded-control px-2 py-1.5 text-[15px] font-semibold text-ink hover:bg-hover">
                    {node.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </main>
  );
}
