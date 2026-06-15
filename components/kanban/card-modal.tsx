"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import {
  type BoardCard,
  type ProjectMember,
  CARD_PRIORITIES,
  PRIORITY_LABELS,
} from "./types";

// ============================================================================
// CardModal — view + edit a single card. PATCHes title / description / priority
// / due date / assignee to /api/projects/:id/cards/:cardId, and DELETEs the
// card. Field bounds mirror lib/kanban/validation.ts. Errors are plain language;
// a 403 surfaces the server's permission message rather than a raw exception.
// ============================================================================

const TITLE_MAX = 500;
const DESCRIPTION_MAX = 20000;

const FIELD_STYLES =
  "mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const LABEL_STYLES =
  "block text-xs font-medium uppercase tracking-wider text-ink-subtle";

interface CardModalProps {
  projectId: string;
  card: BoardCard;
  members: ProjectMember[];
  onClose: () => void;
  onSaved: (card: BoardCard) => void;
  onDeleted: (cardId: string) => void;
}

export function CardModal({
  projectId,
  card,
  members,
  onClose,
  onSaved,
  onDeleted,
}: CardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [assigneeId, setAssigneeId] = useState(card.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (!saving && !deleting) onClose();
  }, [saving, deleting, onClose]);

  // Escape closes the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("A card needs a title.");
      return;
    }
    if (trimmed.length > TITLE_MAX) {
      setError(`Keep the title under ${TITLE_MAX} characters.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/cards/${card.id}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmed,
            description: description.trim(),
            priority,
            dueDate: dueDate.trim(),
            assigneeId: assigneeId || null,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not save the card. Please try again.");
        return;
      }
      onSaved(data.card as BoardCard);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/cards/${card.id}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not delete the card. Please try again.");
        return;
      }
      onDeleted(card.id);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      onMouseDown={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit card"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-canvas sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="text-sm font-medium text-ink">Card</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={handleSave}
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5"
        >
          <div>
            <label htmlFor="card-title" className={LABEL_STYLES}>
              Title
            </label>
            <input
              id="card-title"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              className={FIELD_STYLES}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="card-description" className={LABEL_STYLES}>
              Description
            </label>
            <textarea
              id="card-description"
              rows={4}
              value={description}
              maxLength={DESCRIPTION_MAX}
              placeholder="Notes, acceptance criteria, links. Optional."
              onChange={(e) => setDescription(e.target.value)}
              className={FIELD_STYLES}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="card-priority" className={LABEL_STYLES}>
                Priority
              </label>
              <select
                id="card-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={FIELD_STYLES}
              >
                {CARD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="card-due" className={LABEL_STYLES}>
                Due date
              </label>
              <input
                id="card-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={FIELD_STYLES}
              />
            </div>
          </div>

          {members.length > 0 && (
            <div>
              <label htmlFor="card-assignee" className={LABEL_STYLES}>
                Assignee
              </label>
              <select
                id="card-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={FIELD_STYLES}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName || m.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3">
              <p className="text-sm text-semantic-error">{error}</p>
            </div>
          )}
        </form>

        <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-subtle">Delete this card?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-semantic-error/40 bg-semantic-error/10 px-3 py-1.5 text-sm font-medium text-semantic-error transition-colors hover:bg-semantic-error/20 disabled:opacity-60"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="min-h-11 rounded-md px-3 py-1.5 text-sm text-ink-subtle transition-colors hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-ink-tertiary transition-colors hover:text-semantic-error"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
