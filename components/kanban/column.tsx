"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Loader2 } from "lucide-react";
import { KanbanCard } from "./card";
import { type BoardCard, type BoardColumn, type ProjectMember } from "./types";

// ============================================================================
// KanbanColumn — one board column as a surface-1 panel with a hairline border.
// The header shows the column name and a card-count pill. The card list is a
// dnd-kit droppable + sortable context so a card can be dropped here even when
// the column is empty. An "Add card" affordance creates a card via POST.
// ============================================================================

interface KanbanColumnProps {
  projectId: string;
  column: BoardColumn;
  columns: BoardColumn[];
  members: ProjectMember[];
  onOpenCard: (card: BoardCard) => void;
  onMoveCardToColumn: (card: BoardCard, toColumnId: string) => void;
  onCardCreated: (card: BoardCard) => void;
}

export function KanbanColumn({
  projectId,
  column,
  columns,
  members,
  onOpenCard,
  onMoveCardToColumn,
  onCardCreated,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: "column", columnId: column.id },
  });

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("Give the card a title.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cards`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnId: column.id,
          title: trimmed,
          sortOrder: column.cards.length,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not add the card. Please try again.");
        return;
      }
      onCardCreated(data.card as BoardCard);
      setTitle("");
      setAdding(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-h-full w-[450px] min-w-[450px] flex-col rounded-xl border border-hairline bg-surface-1">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {column.color && (
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: column.color }}
            />
          )}
          <span className="truncate text-sm font-medium text-ink">
            {column.name}
          </span>
          <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle">
            {column.cards.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`min-h-[60px] flex-1 space-y-2 overflow-y-auto px-2 pb-2 transition-colors ${
          isOver ? "rounded-lg bg-surface-2/60" : ""
        }`}
      >
        <SortableContext
          items={column.cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {column.cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              columns={columns}
              members={members}
              onOpen={onOpenCard}
              onMoveToColumn={onMoveCardToColumn}
            />
          ))}
        </SortableContext>

        {column.cards.length === 0 && !adding && (
          <p className="px-1 py-3 text-center text-[11px] text-ink-tertiary">
            No cards yet
          </p>
        )}
      </div>

      <div className="px-2 pb-2">
        {adding ? (
          <form onSubmit={handleAdd} className="space-y-2">
            <textarea
              value={title}
              rows={2}
              maxLength={500}
              autoFocus
              placeholder="Card title"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAdd(e);
                }
              }}
              className="block w-full resize-none rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {error && (
              <p className="text-xs text-semantic-error">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Add card
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                  setError(null);
                }}
                disabled={saving}
                className="min-h-11 rounded-md px-2 py-1.5 text-sm text-ink-tertiary transition-colors hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-11 w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink-subtle"
          >
            <Plus className="h-4 w-4" />
            Add card
          </button>
        )}
      </div>
    </div>
  );
}
