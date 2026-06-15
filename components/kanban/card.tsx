"use client";

import { useState, useRef, useEffect } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Calendar,
  MoreHorizontal,
  ArrowRightLeft,
  GripVertical,
  MessageSquare,
} from "lucide-react";
import {
  type BoardCard,
  type BoardColumn,
  type ProjectMember,
  priorityStyle,
} from "./types";

// ============================================================================
// KanbanCard — a single card as a surface-2 panel. Shows the title, a priority
// dot (lavender ONLY for high|urgent, muted otherwise), an optional due-date
// caption, and the assignee initials. The card is draggable via dnd-kit; a
// "move to column" menu is the keyboard/touch fallback and always calls the
// same move endpoint. Clicking the body opens the edit/detail modal.
// ============================================================================

interface KanbanCardProps {
  card: BoardCard;
  columns: BoardColumn[];
  members: ProjectMember[];
  onOpen: (card: BoardCard) => void;
  onMoveToColumn: (card: BoardCard, toColumnId: string) => void;
}

function memberLabel(
  members: ProjectMember[],
  assigneeId: string | null,
): { initials: string; name: string } | null {
  if (!assigneeId) return null;
  const m = members.find((x) => x.userId === assigneeId);
  const name = m?.displayName || m?.email || "Assignee";
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return { initials: initials || "?", name };
}

function formatDue(date: string): string {
  // dueDate is a calendar date ("YYYY-MM-DD", no time/zone). new Date() parses
  // it as UTC midnight, so we pin the display to UTC — otherwise a viewer in a
  // negative-UTC timezone would see the day before. Order stays en-AU.
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function KanbanCard({
  card,
  columns,
  members,
  onOpen,
  onMoveToColumn,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: "card", card } });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const ps = priorityStyle(card.priority);
  const assignee = memberLabel(members, card.assigneeId);
  const otherColumns = columns.filter((c) => c.id !== card.columnId);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeft: `3px solid ${ps.border}` }}
      {...attributes}
      {...listeners}
      className="group/card relative cursor-grab touch-none rounded-lg border border-hairline bg-surface-2 transition-all hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-lg hover:shadow-black/30 active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5 p-3">
        {/* Visual drag affordance — the whole card is draggable. */}
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-tertiary opacity-0 transition-opacity group-hover/card:opacity-60"
        >
          <GripVertical className="h-4 w-4" />
        </span>

        {/* Body — a tap (move < 6px) opens the modal; a drag moves the card. */}
        <button
          type="button"
          onClick={() => onOpen(card)}
          className="min-w-0 flex-1 text-left"
        >
          {card.labels && card.labels.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {card.labels.map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${l.color || "var(--color-ink-subtle)"} 16%, transparent)`,
                    color: l.color || "var(--color-ink-subtle)",
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}
          <p className="line-clamp-3 text-sm text-ink">{card.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ backgroundColor: ps.bg, color: ps.text }}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: ps.dot }}
              />
              {card.priority}
            </span>
            {card.dueDate && (
              <span className="flex items-center gap-1 text-[11px] text-ink-tertiary">
                <Calendar className="h-3 w-3" />
                {formatDue(card.dueDate)}
              </span>
            )}
            {card.commentCount !== undefined && card.commentCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-ink-tertiary">
                <MessageSquare className="h-3 w-3" />
                {card.commentCount}
              </span>
            )}
          </div>
        </button>

        {/* Assignee + menu trigger. */}
        <div className="flex shrink-0 items-center gap-1">
          {assignee && (
            <span
              title={assignee.name}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-4 text-[10px] font-medium text-ink-subtle"
            >
              {assignee.initials}
            </span>
          )}
          <div
            className="relative"
            ref={menuRef}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Card actions"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-ink-subtle focus:opacity-100 group-hover/card:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-hairline bg-surface-1 py-1 shadow-lg">
                <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-tertiary">
                  Move to
                </p>
                {otherColumns.length === 0 ? (
                  <p className="px-3 py-1.5 text-xs text-ink-tertiary">
                    No other columns
                  </p>
                ) : (
                  otherColumns.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onMoveToColumn(card, c.id);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <ArrowRightLeft className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
