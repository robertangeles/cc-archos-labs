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
 * Whether a priority is "elevated" (high | urgent). Per DESIGN.md the lavender
 * accent is scarce — only an elevated card shows the lavender dot; everything
 * else gets a muted dot.
 */
export function isElevatedPriority(priority: string): boolean {
  return priority === "high" || priority === "urgent";
}
