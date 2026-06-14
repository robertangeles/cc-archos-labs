"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "../components/search/search-result-row";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: SearchResult[] }
  | { status: "error"; message: string };

export function useSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setQuery("");
    setState({ status: "idle" });
    if (abortRef.current) abortRef.current.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ status: "loading" });

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setState({ status: "error", message: body.error ?? "Search failed." });
            return;
          }
          const data = await res.json();
          setState({ status: "done", results: data.results ?? [] });
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setState({ status: "error", message: "Search failed. Please try again." });
        });
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  const trimmed = query.trim();
  const belowMin = trimmed.length < MIN_QUERY_LENGTH;

  return {
    query,
    setQuery,
    results: !belowMin && state.status === "done" ? state.results : [],
    isLoading: !belowMin && state.status === "loading",
    error: !belowMin && state.status === "error" ? state.message : null,
    reset,
  };
}
