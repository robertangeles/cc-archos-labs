// ============================================================================
// Kanban client types — mirror the API shapes from lib/kanban/service.ts so the
// board, card, and modal share one definition. The board GET returns columns,
// each with an embedded `cards` array (getBoard assembles them in memory).
// ============================================================================

export type CardPriority = "low" | "medium" | "high" | "urgent";

export interface BoardCard {
  id: string;
  columnId: string;
  projectId: string;
  title: string;
  description: string | null;
  priority: string;
  dueDate: string | null;
  sortOrder: number;
  assigneeId: string | null;
  coverImageUrl: string | null;
  artifactType: string | null;
  artifactId: string | null;
  artifactUrl: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched by getBoard (additive).
  labels?: CardLabel[];
  commentCount?: number;
}

/** A label definition within a project. */
export interface CardLabel {
  id: string;
  name: string;
  color: string | null;
}

/** A comment on a card, with its author resolved. */
export interface CardComment {
  id: string;
  body: string;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  createdAt: string;
}

/** A history entry for a card (from project_activity). */
export interface CardActivity {
  id: string;
  action: string;
  entityName: string | null;
  userId: string | null;
  displayName: string | null;
  createdAt: string;
}

/** A file attached to a card (stored in Cloudinary). */
export interface CardAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  fileSize: number | null;
  createdAt: string;
}

/** A member of the current organisation (assignable to cards). */
export interface OrgMember {
  userId: string;
  displayName: string | null;
  email: string;
  role: string;
}

export interface BoardColumn {
  id: string;
  projectId: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  cards: BoardCard[];
}

/** A project member, used to resolve + pick card assignees. */
export interface ProjectMember {
  id: string;
  userId: string;
  role: string;
  displayName: string | null;
  email: string;
}

/** Priorities in display order, with how each one reads in the UI. */
export const CARD_PRIORITIES: CardPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const PRIORITY_LABELS: Record<CardPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/**
 * Whether a priority is "elevated" (high | urgent).
 */
export function isElevatedPriority(priority: string): boolean {
  return priority === "high" || priority === "urgent";
}

/**
 * Vibrant priority palette — each priority carries its own colour as a signal
 * (red urgent, amber high, blue medium, slate low). Used for the filled badge
 * on a card and the card's left accent bar.
 */
export interface PriorityStyle {
  dot: string;
  text: string;
  bg: string;
  border: string;
}

export const PRIORITY_STYLES: Record<CardPriority, PriorityStyle> = {
  urgent: {
    dot: "#ef4444",
    text: "#fca5a5",
    bg: "rgba(239, 68, 68, 0.16)",
    border: "#ef4444",
  },
  high: {
    dot: "#f59e0b",
    text: "#fcd34d",
    bg: "rgba(245, 158, 11, 0.16)",
    border: "#f59e0b",
  },
  medium: {
    dot: "#3b82f6",
    text: "#93c5fd",
    bg: "rgba(59, 130, 246, 0.16)",
    border: "#3b82f6",
  },
  low: {
    dot: "#64748b",
    text: "#cbd5e1",
    bg: "rgba(148, 163, 184, 0.14)",
    border: "#64748b",
  },
};

export function priorityStyle(priority: string): PriorityStyle {
  return PRIORITY_STYLES[priority as CardPriority] ?? PRIORITY_STYLES.medium;
}

/**
 * Default column accent palette, cycled by column position when a column has no
 * explicit colour. Mirrors a board's natural flow: slate → amber → blue → green
 * → violet → pink.
 */
export const COLUMN_ACCENTS = [
  "#64748b",
  "#f59e0b",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#ec4899",
];

export function columnAccent(color: string | null, index: number): string {
  return color || COLUMN_ACCENTS[index % COLUMN_ACCENTS.length];
}
