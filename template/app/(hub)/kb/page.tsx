import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { getHub } from "@/lib/web/get-hub";
import { buildGraph } from "@/lib/web/graph";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const { board, pages } = await getHub();
  const { nodes, edges } = buildGraph(board, pages);
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 pt-4 sm:px-4">
      <div className="px-1">
        <h1 className="text-[24px] font-semibold text-ink">Knowledge</h1>
        <p className="text-[15px] text-ink-2">Every kb page in five areas, linked wherever one names another, with people and open work attached.</p>
      </div>
      <KnowledgeGraph nodes={nodes} edges={edges} listOpen />
    </main>
  );
}
