"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WorkflowCreator() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create workflow");
        return;
      }

      const data = await res.json();
      router.push(`/account/workflows/${data.workflow.id}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="text-lg font-semibold text-ink">New Workflow</h2>
      <p className="mt-1 text-sm text-ink-subtle">
        One idea in, twelve assets out. Create a multi-step AI pipeline.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            {error}
          </div>
        )}

        <div>
          <label
            htmlFor="wf-name"
            className="mb-1 block text-sm font-medium text-ink-subtle"
          >
            Name
          </label>
          <input
            id="wf-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Data Quality Report Generator"
            required
            maxLength={255}
            className="w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div>
          <label
            htmlFor="wf-desc"
            className="mb-1 block text-sm font-medium text-ink-subtle"
          >
            Description (optional)
          </label>
          <textarea
            id="wf-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this workflow do?"
            rows={3}
            maxLength={5000}
            className="w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Workflow"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/account/workflows")}
            className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink-subtle transition-colors hover:bg-surface-1"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
