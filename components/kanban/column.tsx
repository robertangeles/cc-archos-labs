"use client";

import { useState } from "react";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Loader2, GripVertical } from "lucide-react";
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
  accent: string;
  onOpenCard: (card: BoardCard) => void;
  onMoveCardToColumn: (card: BoardCard, toColumnId: string) => void;
  onCardCreated: (card: BoardCard) => void;
}

export function KanbanColumn({
  projectId,
  column,
  columns,
  members,
  accent,
  onOpenCard,
  onMoveCardToColumn,
  onCardCreated,
}: KanbanColumnProps) {
  // The column is a sortable item (for column reorder) AND the droppable target
  // for cards — useSortable provides both. Only the header is the drag activator
  // so dragging a card inside the column never starts a column drag.
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
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
    <div
      ref={setNodeRef}
      style={{
        borderTop: `2px solid ${accent}`,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex max-h-full w-[300px] min-w-[300px] flex-col rounded-xl border border-hairline bg-surface-1"
    >
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="group/col flex cursor-grab items-center justify-between gap-2 px-3 py-2.5 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="truncate text-sm font-semibold text-ink">
            {column.name}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor: `color-mix(in srgb, ${accent} 20%, transparent)`,
              color: accent,
            }}
          >
            {column.cards.length}
          </span>
        </div>
        <GripVertical className="h-4 w-4 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover/col:opacity-60" />
      </div>

      <div
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
