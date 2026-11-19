export function HubError({ message, heading = "The hub could not be read" }: { message: string; heading?: string }) {
  return (
    <div role="alert" className="rounded-card border border-divider bg-card px-4 py-3 shadow-card">
      <p className="text-[15px] font-semibold text-ink">{heading}</p>
      <p className="mt-0.5 text-[13px] text-ink-2">{message}</p>
    </div>
  );
}
