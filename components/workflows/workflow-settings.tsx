"use client";

import { useState } from "react";

interface WorkflowSettingsProps {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  onUpdate: (updates: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WorkflowSettings({
  workflow,
  onUpdate,
  onDelete,
}: WorkflowSettingsProps) {
  const [description, setDescription] = useState(
    workflow.description ?? "",
  );
  const [status, setStatus] = useState(workflow.status);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDescriptionBlur = async () => {
    if (description !== (workflow.description ?? "")) {
      setSaving(true);
      await onUpdate({ description: description || null });
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus);
    await onUpdate({ status: newStatus });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-subtle">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="Describe what this workflow does..."
            rows={3}
            className="w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary/40 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink-subtle">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="w-full rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink focus:border-primary/40 focus:outline-none"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {saving && (
          <p className="text-xs text-ink-tertiary">Saving...</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-ink-tertiary">Created</p>
          <p className="font-medium text-ink">
            {formatDate(workflow.createdAt)}
          </p>
        </div>
        <div>
          <p className="text-ink-tertiary">Last Updated</p>
          <p className="font-medium text-ink">
            {formatDate(workflow.updatedAt)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-red-500/30 p-4">
        <h4 className="text-sm font-medium text-red-500">Danger Zone</h4>
        <p className="mt-1 text-xs text-ink-subtle">
          Permanently delete this workflow and all its configuration.
        </p>
        {confirmDelete ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
            >
              Yes, delete permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-subtle transition-colors hover:bg-surface-1"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            Delete Workflow
          </button>
        )}
      </div>
    </div>
  );
}
