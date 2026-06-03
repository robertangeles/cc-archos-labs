"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ExamResults, type AnswerDetail } from "../../exam-results";
import type { ExamResult } from "@/lib/cdmp/scoring";

interface HistoryData {
  result: ExamResult;
  answers: AnswerDetail[];
}

export default function HistoryResultsPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/cdmp/results/${params.sessionId}`);
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = "/login?redirect=/account";
            return;
          }
          throw new Error("Failed to load results");
        }
        const json = await res.json();
        setData({ result: json.result, answers: json.answers });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.sessionId]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-ink-subtle">Loading results...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-32">
        <p className="text-lg font-medium text-ink">Could not load results</p>
        <p className="text-sm text-ink-subtle">{error}</p>
        <button
          type="button"
          onClick={() => router.push("/account")}
          className="mt-4 rounded-md bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Back to account
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-canvas px-4 pt-4 md:px-8 lg:px-12">
        <button
          type="button"
          onClick={() => router.push("/account")}
          className="inline-flex items-center gap-1.5 text-sm text-ink-subtle transition-colors duration-150 hover:text-ink"
        >
          <span aria-hidden="true">&larr;</span> Back to history
        </button>
      </div>
      <ExamResults
        result={data.result}
        answers={data.answers}
        onRetry={() => router.push("/tools/cdmp-practice")}
      />
    </div>
  );
}
