"use client";

import { useState } from "react";

interface SourceCitationsProps {
  memories: string[];
}

export function SourceCitations({ memories }: SourceCitationsProps) {
  const [expanded, setExpanded] = useState(false);

  if (memories.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                   bg-[#141516] border border-[#23252a] hover:border-[#34343a]
                   text-xs text-[#d0d6e0] transition-colors cursor-pointer"
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        From {memories.length} past session{memories.length > 1 ? "s" : ""}
      </button>

      {expanded && (
        <div className="mt-2 pl-3 border-l-2 border-[#23252a] space-y-1">
          {memories.map((memory, i) => (
            <p key={i} className="text-xs text-[#d0d6e0] leading-relaxed">
              {memory}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
