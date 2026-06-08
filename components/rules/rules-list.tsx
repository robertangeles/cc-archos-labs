"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Shield, Plus, Pencil, Trash2 } from "lucide-react";
import { RuleForm } from "./rule-form";

interface Rule {
  id: string;
  name: string;
  category: string;
  content: string;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      type: "spring" as const,
      stiffness: 100,
      damping: 10,
    },
  }),
};

export function RulesList() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const fetchRules = useCallback(() => {
    fetch("/api/rules")
      .then((r) => r.json())
      .then((data) => setRules(data.rules ?? []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  function handleToggle(rule: Rule) {
    const newEnabled = !rule.isEnabled;
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: newEnabled } : r)),
    );

    fetch(`/api/rules/${rule.id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: newEnabled }),
    }).catch(() => {
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, isEnabled: !newEnabled } : r,
        ),
      );
    });
  }

  function handleDelete(rule: Rule) {
    if (!confirm(`Delete "${rule.name}"? This cannot be undone.`)) return;

    setRules((prev) => prev.filter((r) => r.id !== rule.id));

    fetch(`/api/rules/${rule.id}`, { method: "DELETE" }).catch(() => {
      fetchRules();
    });
  }

  function handleEdit(rule: Rule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  function handleSaved() {
    setShowForm(false);
    setEditingRule(null);
    fetchRules();
  }

  function handleCancel() {
    setShowForm(false);
    setEditingRule(null);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
        <p className="text-xs text-ink-subtle">
          Rules are injected as system instructions into{" "}
          <strong className="font-medium text-ink">every AI call</strong> in
          your skills and workflows. Active rules apply globally — no need to
          repeat them in skill prompts.
        </p>
      </div>

      {showForm && (
        <div className="mb-6">
          <RuleForm
            rule={editingRule}
            existingCategories={[
              ...new Set(rules.map((r) => r.category)),
            ]}
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        </div>
      )}

      {rules.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
          <Shield className="mx-auto h-8 w-8 text-ink-tertiary" />
          <h3 className="mt-4 text-sm font-medium text-ink">
            Create your first personalisation rule
          </h3>
          <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
            Rules shape how AI responds across all your skills and workflows.
            Add writing style, tone preferences, or content guidelines.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            Add Rule
          </button>
        </div>
      ) : (
        <>
          {!showForm && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[11px] text-ink-tertiary">
                {rules.length} rule{rules.length === 1 ? "" : "s"}
              </p>
              <button
                onClick={() => {
                  setEditingRule(null);
                  setShowForm(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Rule
              </button>
            </div>
          )}

          <ul className="space-y-2">
            {rules.map((rule, i) => (
              <motion.li
                key={rule.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
              >
                <div className={`rounded-lg border border-hairline bg-surface-1 px-5 py-4 transition-all duration-150 hover:border-hairline-strong ${
                  rule.isEnabled ? "" : "opacity-60"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">
                          {rule.name}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {rule.category.charAt(0).toUpperCase() + rule.category.slice(1)}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs text-ink-subtle">
                        {rule.content}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => handleToggle(rule)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
                          rule.isEnabled ? "bg-primary" : "bg-surface-3"
                        }`}
                        aria-label={
                          rule.isEnabled ? "Disable rule" : "Enable rule"
                        }
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                            rule.isEnabled
                              ? "translate-x-[18px]"
                              : "translate-x-[2px]"
                          } mt-[2px]`}
                        />
                      </button>
                      <button
                        onClick={() => handleEdit(rule)}
                        className="text-ink-subtle transition-colors hover:text-ink"
                        aria-label="Edit rule"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(rule)}
                        className="text-ink-subtle transition-colors hover:text-red-500"
                        aria-label="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
