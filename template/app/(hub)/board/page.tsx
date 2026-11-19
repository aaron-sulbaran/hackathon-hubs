import Link from "next/link";
import { Suspense } from "react";
import { BoardView } from "@/components/BoardView";
import { Feed } from "@/components/Feed";
import { WritesOffNote } from "@/components/HubContext";
import { HubError } from "@/components/HubError";
import { withBasePath } from "@/lib/web/base-path";
import { toEntries } from "@/lib/web/entries";
import { getHub } from "@/lib/web/get-hub";
import { itemViews } from "@/lib/web/views";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const { board, nowIso, repo, error } = await getHub();
  const open = board.items.filter((item) => item.lane !== "done").length;
  // Pitch clock presses are state, not news: they stay out of the feed.
  const entries = toEntries(board, board.activity.filter((event) => event.type !== "script.clock").slice(0, 200), repo);
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-4 px-3 pt-4 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[24px] font-semibold text-ink">Board</h1>
          <p className="text-[13px] text-ink-2 tabular-nums">
            {open} open, {board.items.length - open} done
          </p>
        </div>
        <nav aria-label="More" className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
          <Link href="/decide" className="inline-flex min-h-8 items-center font-medium text-link underline decoration-1 underline-offset-[3px]">
            Questions and calls
          </Link>
          <Link href="/design" className="inline-flex min-h-8 items-center font-medium text-link underline decoration-1 underline-offset-[3px]">
            Design reviews
          </Link>
          <a href={withBasePath("/script")} className="inline-flex min-h-8 items-center font-medium text-link underline decoration-1 underline-offset-[3px]">
            Pitch script
          </a>
        </nav>
      </div>
      {error && <HubError message={error} />}
      <WritesOffNote />
      <Suspense>
        <BoardView views={itemViews(board, repo)} nowIso={nowIso} />
      </Suspense>
      <section aria-labelledby="feed-heading" className="mx-auto mt-4 flex w-full max-w-[680px] flex-col gap-3">
        <h2 id="feed-heading" className="px-1 text-[20px] font-semibold text-ink">
          Latest posts
        </h2>
        <Feed entries={entries} nowIso={nowIso} />
      </section>
    </main>
  );
}
