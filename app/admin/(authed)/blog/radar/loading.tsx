// Shown while the radar page loads: five rows at the real row height, so the page
// does not jump when the list arrives (DES loading state).

export default function RadarLoading() {
  return (
    <section aria-busy="true" aria-label="Loading the radar">
      <div className="mb-6">
        <div className="h-10 w-40 rounded-md bg-surface-2" />
        <div className="mt-2 h-4 w-80 max-w-full rounded-md bg-surface-2" />
      </div>
      <div className="rounded-lg border border-hairline bg-surface-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[104px] border-b border-hairline px-4 py-3 last:border-b-0">
            <div className="h-[22px] w-3/5 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="mt-2 h-4 w-2/5 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            <div className="mt-2 h-4 w-4/5 rounded-md bg-surface-2 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </section>
  );
}
