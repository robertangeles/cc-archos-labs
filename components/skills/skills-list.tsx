"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  RefreshCw,
  Sparkles,
  Search,
  Zap,
  Gem,
  ClipboardList,
  Plus,
  type LucideIcon,
} from "lucide-react";

interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  defaultModel: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  repurpose: RefreshCw,
  generate: Sparkles,
  research: Search,
  transform: Zap,
  extract: Gem,
  plan: ClipboardList,
};

const CATEGORY_COLORS: Record<string, string> = {
  repurpose: "var(--color-category-repurpose)",
  generate: "var(--color-category-generate)",
  research: "var(--color-category-research)",
  transform: "var(--color-category-transform)",
  extract: "var(--color-category-extract)",
  plan: "var(--color-category-plan)",
};

function CategoryIcon({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] ?? Sparkles;
  return <Icon className="h-4 w-4" />;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, type: "spring" as const, stiffness: 100, damping: 10 },
  }),
};

export function SkillsList() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[72px] animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h3 className="mt-4 text-sm font-medium text-ink">
          Create your first AI skill
        </h3>
        <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
          Skills are reusable AI prompts you can run with different inputs.
          Build one to get started.
        </p>
        <Link
          href="/account/skills/new"
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" />
          New Skill
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] text-ink-tertiary">
          {skills.length} skill{skills.length === 1 ? "" : "s"}
        </p>
        <Link
          href="/account/skills/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New Skill
        </Link>
      </div>

      <ul className="space-y-2">
        {skills.map((s, i) => (
          <motion.li
            key={s.id}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
          >
            <Link
              href={`/account/skills/${s.id}`}
              className="group flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2"
              style={{
                borderLeftWidth: "3px",
                borderLeftColor: CATEGORY_COLORS[s.category] ?? "var(--color-hairline)",
              }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${CATEGORY_COLORS[s.category] ?? "var(--color-primary)"} 10%, transparent)`,
                    color: CATEGORY_COLORS[s.category] ?? "var(--color-primary)",
                  }}
                >
                  <CategoryIcon category={s.category} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink group-hover:text-primary-hover transition-colors">
                    {s.name}
                  </span>
                  <span className="line-clamp-1 text-xs text-ink-subtle">
                    {s.description}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${CATEGORY_COLORS[s.category] ?? "var(--color-primary)"} 10%, transparent)`,
                    color: CATEGORY_COLORS[s.category] ?? "var(--color-ink-subtle)",
                  }}
                >
                  {s.category}
                </span>
                <span className="text-[11px] text-ink-tertiary">
                  {formatDate(s.updatedAt)}
                </span>
              </div>
            </Link>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
