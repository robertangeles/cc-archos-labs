"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { useSearch } from "../../hooks/use-search";
import { SearchResultRow } from "../../components/search/search-result-row";

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { query, setQuery, results, isLoading, error } = useSearch();

  useEffect(() => {
    const initial = searchParams.get("q") ?? "";
    if (initial && !query) setQuery(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      router.replace(`/search?q=${encodeURIComponent(trimmed)}`, {
        scroll: false,
      });
    } else if (trimmed.length === 0) {
      router.replace("/search", { scroll: false });
    }
  }, [query, router]);

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-12 md:px-12">
      <h1 className="text-display-md font-semibold tracking-tight text-ink md:text-display-lg">
        Search
      </h1>

      <div className="relative mt-8">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-subtle"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all essays..."
          autoFocus
          className="w-full rounded-lg border border-hairline bg-surface-1 py-3 pl-10 pr-4 text-base text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="mt-8">
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {isLoading && (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-3 border-b border-hairline py-8">
                <div className="h-3 w-20 rounded bg-surface-1" />
                <div className="h-5 w-3/4 rounded bg-surface-1" />
                <div className="h-4 w-full rounded bg-surface-1" />
                <div className="h-3 w-32 rounded bg-surface-1" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p className="text-ink-subtle">
            No results for &ldquo;{query.trim()}&rdquo;. Try a different search term.
          </p>
        )}

        {!isLoading && !error && results.length > 0 && (
          <ul>
            {results.map((r) => (
              <SearchResultRow key={r.slug} result={r} />
            ))}
          </ul>
        )}

        {!isLoading && !error && query.trim().length < 2 && (
          <p className="text-ink-subtle">
            Enter a search term to find essays.
          </p>
        )}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
