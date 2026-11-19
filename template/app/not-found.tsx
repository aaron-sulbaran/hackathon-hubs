import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[520px] px-4 pt-16 text-center">
      <h1 className="text-[24px] font-semibold text-ink">Nothing here</h1>
      <p className="mt-1 text-[15px] text-ink-2">That page is not on the hub.</p>
      <Link href="/" className="mt-4 inline-block rounded-control bg-primary px-4 py-2 text-[15px] font-semibold text-on-primary">
        Back to home
      </Link>
    </main>
  );
}
