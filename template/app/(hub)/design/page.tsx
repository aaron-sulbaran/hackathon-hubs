import { DesignReviews } from "@/components/DesignReviews";
import { HubError } from "@/components/HubError";
import { getHub } from "@/lib/web/get-hub";
import { designReviewViews } from "@/lib/web/views";

export const dynamic = "force-dynamic";

export default async function DesignPage() {
  const { board, nowIso, repo, error } = await getHub();
  const reviews = designReviewViews(board, repo);
  return (
    <main className="mx-auto flex max-w-[680px] flex-col gap-4 px-2 pt-4 sm:px-4">
      <div className="px-1">
        <h1 className="text-[24px] font-semibold text-ink">Design</h1>
        <p className="text-[15px] text-ink-2">Screenshots and mockups the team is reviewing. Say what should change; mark a review resolved once it is handled.</p>
      </div>
      {error && <HubError message={error} />}
      <DesignReviews reviews={reviews} nowIso={nowIso} />
    </main>
  );
}
