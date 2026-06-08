"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface Rule {
  id: string;
  name: string;
  category: string;
  content: string;
  isEnabled: boolean;
}

interface RuleFormProps {
  rule?: Rule | null;
  existingCategories: string[];
  onSaved: () => void;
  onCancel: () => void;
}

export function RuleForm({
  rule,
  existingCategories,
  onSaved,
  onCancel,
}: RuleFormProps) {
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name ?? "");
  const defaultCategories = ["Writing", "Formatting", "Brand", "Other"];
  const allCategories = [
    ...new Set([
      ...defaultCategories.slice(0, -1),
      ...existingCategories.map(
        (c) => c.charAt(0).toUpperCase() + c.slice(1)
      ),
      "Other",
    ]),
  ];

  const initialCategory = rule?.category
    ? rule.category.charAt(0).toUpperCase() + rule.category.slice(1)
    : "";
  const isKnown = initialCategory && allCategories.includes(initialCategory);

  const [selectedCategory, setSelectedCategory] = useState(
    isKnown ? initialCategory : initialCategory ? "Other" : ""
  );
  const [customCategory, setCustomCategory] = useState(
    isKnown ? "" : initialCategory
  );

  const category =
    selectedCategory === "Other" ? customCategory : selectedCategory;
  const [content, setContent] = useState(rule?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const url = isEdit ? `/api/rules/${rule.id}` : "/api/rules";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim(),
          content: content.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Failed to ${isEdit ? "update" : "create"} rule.`);
        return;
      }

      onSaved();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-hairline bg-surface-1 p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">
          {isEdit ? "Edit Rule" : "New Rule"}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-subtle transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-subtle">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Banned Words"
              required
              maxLength={255}
              className="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-subtle">
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                if (e.target.value !== "Other") setCustomCategory("");
              }}
              required
              className="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="" disabled>
                Select a category
              </option>
              {allCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {selectedCategory === "Other" && (
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Enter custom category"
                required
                maxLength={100}
                autoFocus
                className="mt-2 w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-ink-subtle">
            Rule content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the rule that will be injected as a system instruction into every AI call..."
            required
            maxLength={10000}
            rows={6}
            className="w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-[11px] text-ink-tertiary">
            {content.length.toLocaleString()} / 10,000 characters
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-ink-subtle transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || !category.trim() || !content.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving..." : isEdit ? "Update Rule" : "Create Rule"}
        </button>
      </div>
    </form>
  );
}
