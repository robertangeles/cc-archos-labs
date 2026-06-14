"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSearch } from "../../hooks/use-search";
import { SearchResultRow } from "./search-result-row";

interface SearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchDialog({ isOpen, onClose }: SearchDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { query, setQuery, results, isLoading, error, reset } = useSearch();
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen && !el.open) {
      el.showModal();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!isOpen && el.open) {
      el.close();
      reset();
      setActiveIndex(-1);
    }
  }, [isOpen, reset]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function handleCancel(event: Event) {
      event.preventDefault();
      onClose();
    }
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  const navigateToResult = useCallback(
    (slug: string) => {
      onClose();
      router.push(`/blog/${slug}`);
    },
    [onClose, router],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev > 0 ? prev - 1 : results.length - 1,
      );
    } else if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault();
      navigateToResult(results[activeIndex].slug);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="Search"
      onKeyDown={handleKeyDown}
      className="m-0 max-h-none max-w-none bg-transparent p-0 backdrop:bg-canvas/80 backdrop:backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="fixed inset-0 z-0 cursor-default bg-transparent"
        tabIndex={-1}
      />
      <div
        role="document"
        className="fixed inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-[600px] flex-col overflow-hidden rounded-t-lg border border-hairline bg-surface-2 motion-safe:animate-[slideup_200ms_ease-out] sm:bottom-auto sm:top-[20vh] sm:rounded-lg"
      >
        <div className="flex items-center gap-x-3 border-b border-hairline px-4 py-3">
          <svg
            className="h-5 w-5 shrink-0 text-ink-subtle"
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
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
            }}
            placeholder="Search essays..."
            className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-subtle/60 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-hairline px-1.5 py-0.5 text-xs text-ink-subtle sm:inline-block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 py-2 sm:max-h-[400px]">
          {error && (
            <p className="px-3 py-4 text-sm text-red-600">{error}</p>
          )}

          {isLoading && (
            <div className="space-y-1 px-3 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-1.5 rounded px-3 py-2.5">
                  <div className="h-4 w-3/4 rounded bg-surface-1" />
                  <div className="h-3 w-1/3 rounded bg-surface-1" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-3 py-4 text-sm text-ink-subtle">
              No results for &ldquo;{query.trim()}&rdquo;
            </p>
          )}

          {!isLoading && !error && results.length > 0 && (
            <div role="listbox">
              {results.map((r, i) => (
                <SearchResultRow
                  key={r.slug}
                  result={r}
                  compact
                  isActive={i === activeIndex}
                  onClick={() => navigateToResult(r.slug)}
                />
              ))}
            </div>
          )}

          {!isLoading && !error && query.trim().length < 2 && (
            <p className="px-3 py-4 text-sm text-ink-subtle">
              Search across all essays
            </p>
          )}
        </div>

        <div className="hidden items-center gap-x-4 border-t border-hairline px-4 py-2 text-xs text-ink-subtle sm:flex">
          <span>
            <kbd className="rounded border border-hairline px-1 py-0.5">↑</kbd>{" "}
            <kbd className="rounded border border-hairline px-1 py-0.5">↓</kbd>{" "}
            to navigate
          </span>
          <span>
            <kbd className="rounded border border-hairline px-1 py-0.5">↵</kbd>{" "}
            to open
          </span>
          <span>
            <kbd className="rounded border border-hairline px-1 py-0.5">esc</kbd>{" "}
            to close
          </span>
        </div>
      </div>
    </dialog>
  );
}
