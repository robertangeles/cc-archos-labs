"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus, Loader2, AlertCircle } from "lucide-react";
import { KanbanColumn } from "./column";
import { CardModal } from "./card-modal";
import {
  type BoardCard,
  type BoardColumn,
  type ProjectMember,
  type OrgMember,
  columnAccent,
} from "./types";

// ============================================================================
// KanbanBoard — fetches the full board (columns with embedded cards) and the
// project's members, then renders the columns horizontally (the row scrolls on
// phones; each column is min-w-[300px]). Drag-to-move uses dnd-kit with a
// PointerSensor (works with touch) + KeyboardSensor. On drop the card is moved
// optimistically and PATCHed to /move; any failure re-fetches the board so the
// UI never drifts from the server. A "move to column" menu on each card is the
// non-drag fallback and calls the same endpoint.
// ============================================================================

interface KanbanBoardProps {
  projectId: string;
}

/** Find which column currently holds a card id. */
function findColumnOfCard(
  columns: BoardColumn[],
  cardId: string,
): BoardColumn | undefined {
  return columns.find((col) => col.cards.some((c) => c.id === cardId));
}

/** Renumber cards' sortOrder to match their array position. */
function renumber(cards: BoardCard[]): BoardCard[] {
  return cards.map((c, i) => ({ ...c, sortOrder: i }));
}

/**
 * Pure reorder: remove the card from its source column and insert it into the
 * target column at `targetIndex`, then renumber sortOrder in both columns. A
 * module-scope pure function so it is never a hook dependency.
 */
function applyMove(
  current: BoardColumn[],
  cardId: string,
  sourceColumnId: string,
  targetColumnId: string,
  targetIndex: number,
): BoardColumn[] {
  const card = current
    .find((c) => c.id === sourceColumnId)
    ?.cards.find((c) => c.id === cardId);
  if (!card) return current;

  return current.map((col) => {
    if (col.id === sourceColumnId && col.id === targetColumnId) {
      // Same-column reorder.
      const without = col.cards.filter((c) => c.id !== cardId);
      without.splice(targetIndex, 0, { ...card, columnId: col.id });
      return { ...col, cards: renumber(without) };
    }
    if (col.id === sourceColumnId) {
      return {
        ...col,
        cards: renumber(col.cards.filter((c) => c.id !== cardId)),
      };
    }
    if (col.id === targetColumnId) {
      const next = [...col.cards];
      next.splice(targetIndex, 0, { ...card, columnId: col.id });
      return { ...col, cards: renumber(next) };
    }
    return col;
  });
}

export function KanbanBoard({ projectId }: KanbanBoardProps) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [openCard, setOpenCard] = useState<BoardCard | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);

  // Snapshot used to roll back an optimistic move when the PATCH fails.
  const preMoveSnapshot = useRef<BoardColumn[] | null>(null);

  const sensors = useSensors(
    // A small distance threshold lets a tap-through still register as a click
    // (so opening a card's modal works) while a deliberate drag starts a move.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Reusable board fetch for the Retry button and post-failure recovery. The
  // first await runs before any setState, so calling this never triggers a
  // synchronous state update (callers clear loadError themselves when needed).
  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/cards`, {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setLoadError(data?.error ?? "Could not load the board. Please refresh.");
        return;
      }
      setColumns((data.board ?? []) as BoardColumn[]);
      setLoadError(null);
    } catch {
      setLoadError("Could not load the board. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Run the load inside an async IIFE so every state update happens past an
    // await — never synchronously in the effect body. `loading` starts true and
    // `loadError` starts null, so the first paint is the skeleton.
    void (async () => {
      await fetchBoard();
    })();
    // Project members power the board's member list. A failure is non-fatal.
    fetch(`/api/projects/${projectId}/members`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => setMembers((data.members ?? []) as ProjectMember[]))
      .catch(() => setMembers([]));
    // Org members are assignable to cards (the assignee may not be a project
    // member). Used to resolve assignee avatars on every card face.
    fetch("/api/organisations/members", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.members) setOrgMembers(data.members as OrgMember[]);
      })
      .catch(() => setOrgMembers([]));
  }, [fetchBoard, projectId]);

  // Union of project + org members (deduped by userId) so any assignee resolves
  // to a name/avatar on a card, regardless of project membership.
  const displayMembers: ProjectMember[] = (() => {
    const byId = new Map<string, ProjectMember>();
    for (const m of members) byId.set(m.userId, m);
    for (const o of orgMembers) {
      if (!byId.has(o.userId)) {
        byId.set(o.userId, {
          id: o.userId,
          userId: o.userId,
          role: o.role,
          displayName: o.displayName,
          email: o.email,
        });
      }
    }
    return Array.from(byId.values());
  })();

  // ---- drag handlers -------------------------------------------------------

  function handleDragStart(event: DragStartEvent) {
    const card = event.active.data.current?.card as BoardCard | undefined;
    if (card) setActiveCard(card);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const sourceColumn = findColumnOfCard(columns, cardId);
    if (!sourceColumn) return;

    // The drop target is either a card (drop onto/between cards) or a column
    // (drop into an empty column / column body).
    const overData = over.data.current as
      | { type?: string; columnId?: string; card?: BoardCard }
      | undefined;

    let targetColumnId: string;
    let targetIndex: number;

    if (overData?.type === "column") {
      targetColumnId = overData.columnId ?? String(over.id);
      const targetCol = columns.find((c) => c.id === targetColumnId);
      targetIndex = targetCol ? targetCol.cards.length : 0;
    } else {
      // Dropped over another card — adopt that card's column + position.
      const overColumn = findColumnOfCard(columns, String(over.id));
      if (!overColumn) return;
      targetColumnId = overColumn.id;
      targetIndex = overColumn.cards.findIndex((c) => c.id === String(over.id));
      if (targetIndex < 0) targetIndex = overColumn.cards.length;
    }

    const sourceIndex = sourceColumn.cards.findIndex((c) => c.id === cardId);
    // No-op: same column, same slot.
    if (sourceColumn.id === targetColumnId && sourceIndex === targetIndex) {
      return;
    }

    preMoveSnapshot.current = columns;
    const moved = applyMove(
      columns,
      cardId,
      sourceColumn.id,
      targetColumnId,
      targetIndex,
    );
    setColumns(moved);

    await persistMove(cardId, targetColumnId, targetIndex);
  }

  /** PATCH the move; roll back + re-fetch on failure. */
  const persistMove = useCallback(
    async (cardId: string, toColumnId: string, toSortOrder: number) => {
      setMoveError(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/cards/${cardId}/move`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toColumnId, toSortOrder }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          setMoveError(
            data?.error ?? "Could not move the card. It has been put back.",
          );
          if (preMoveSnapshot.current) setColumns(preMoveSnapshot.current);
          await fetchBoard();
        }
      } catch {
        setMoveError("Could not move the card. It has been put back.");
        if (preMoveSnapshot.current) setColumns(preMoveSnapshot.current);
        await fetchBoard();
      } finally {
        preMoveSnapshot.current = null;
      }
    },
    [projectId, fetchBoard],
  );

  /** Fallback move triggered by the per-card "move to column" menu. */
  const handleMoveCardToColumn = useCallback(
    async (card: BoardCard, toColumnId: string) => {
      const target = columns.find((c) => c.id === toColumnId);
      const targetIndex = target ? target.cards.length : 0;
      preMoveSnapshot.current = columns;
      setColumns((prev) =>
        applyMove(prev, card.id, card.columnId, toColumnId, targetIndex),
      );
      await persistMove(card.id, toColumnId, targetIndex);
    },
    [columns, persistMove],
  );

  // ---- card create / save / delete callbacks -------------------------------

  function handleCardCreated(card: BoardCard) {
    setColumns((prev) =>
      prev.map((col) =>
        col.id === card.columnId
          ? { ...col, cards: [...col.cards, card] }
          : col,
      ),
    );
  }

  function handleCardSaved(card: BoardCard) {
    setColumns((prev) =>
      prev.map((col) =>
        col.id === card.columnId
          ? { ...col, cards: col.cards.map((c) => (c.id === card.id ? card : c)) }
          : col,
      ),
    );
    setOpenCard(null);
  }

  function handleCardDeleted(cardId: string) {
    setColumns((prev) =>
      prev.map((col) => ({
        ...col,
        cards: col.cards.filter((c) => c.id !== cardId),
      })),
    );
    setOpenCard(null);
  }

  function handleColumnCreated(column: BoardColumn) {
    setColumns((prev) => [...prev, { ...column, cards: [] }]);
    setAddingColumn(false);
  }

  // ---- render --------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-72 w-[300px] min-w-[300px] animate-pulse rounded-xl border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-ink-tertiary" />
        <p className="text-sm text-ink-subtle">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchBoard();
          }}
          className="ml-auto text-sm font-medium text-primary transition-colors hover:text-primary-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Colourful summary — one chip per column, accent-coded, with its count. */}
      {columns.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {columns.map((c, i) => {
            const accent = columnAccent(c.color, i);
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-3 py-2"
                style={{ borderLeft: `3px solid ${accent}` }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: accent }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {c.name}
                </span>
                <span className="text-sm font-bold text-ink">
                  {c.cards.length}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {moveError && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-semantic-error" />
          <p className="text-sm text-semantic-error">{moveError}</p>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div className="flex items-start gap-4 overflow-x-auto pb-2">
          {columns.map((column, index) => (
            <KanbanColumn
              key={column.id}
              projectId={projectId}
              column={column}
              columns={columns}
              members={displayMembers}
              accent={columnAccent(column.color, index)}
              onOpenCard={setOpenCard}
              onMoveCardToColumn={handleMoveCardToColumn}
              onCardCreated={handleCardCreated}
            />
          ))}

          <div className="w-[260px] min-w-[260px] shrink-0">
            {addingColumn ? (
              <AddColumnForm
                projectId={projectId}
                sortOrder={columns.length}
                onCreated={handleColumnCreated}
                onCancel={() => setAddingColumn(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingColumn(true)}
                className="flex min-h-11 w-full items-center gap-1.5 rounded-xl border border-dashed border-hairline px-3 py-3 text-left text-sm text-ink-tertiary transition-colors hover:border-hairline-strong hover:text-ink-subtle"
              >
                <Plus className="h-4 w-4" />
                Add column
              </button>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="w-[284px] rounded-lg border border-hairline-strong bg-surface-2 p-3 shadow-lg">
              <p className="line-clamp-3 text-sm text-ink">{activeCard.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardModal
          projectId={projectId}
          card={openCard}
          members={displayMembers}
          onClose={() => setOpenCard(null)}
          onSaved={handleCardSaved}
          onDeleted={handleCardDeleted}
        />
      )}
    </div>
  );
}

// ---- Add column form -------------------------------------------------------

interface AddColumnFormProps {
  projectId: string;
  sortOrder: number;
  onCreated: (column: BoardColumn) => void;
  onCancel: () => void;
}

function AddColumnForm({
  projectId,
  sortOrder,
  onCreated,
  onCancel,
}: AddColumnFormProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Name the column.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/columns`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, sortOrder }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not add the column. Please try again.");
        return;
      }
      onCreated(data.column as BoardColumn);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-xl border border-hairline bg-surface-1 p-2"
    >
      <input
        type="text"
        value={name}
        maxLength={100}
        autoFocus
        placeholder="Column name"
        onChange={(e) => setName(e.target.value)}
        className="block w-full rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {error && <p className="px-1 text-xs text-semantic-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="min-h-11 rounded-md px-2 py-1.5 text-sm text-ink-tertiary transition-colors hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
