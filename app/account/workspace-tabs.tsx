"use client";

import { useState, type ReactNode } from "react";

interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

export function WorkspaceTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");

  return (
    <div>
      <div className="flex gap-1 border-b border-hairline">
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
                isActive ? "text-ink" : "text-ink-subtle hover:text-ink"
              }`}
            >
              {t.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-6">
        {tabs.find((t) => t.key === active)?.content}
      </div>
    </div>
  );
}
