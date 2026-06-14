// ============================================================================
// Project status presentation — the single source for how each project status
// reads and colors across the projects list and detail header. Status values
// mirror lib/projects/validation.ts: active | on_hold | completed | archived.
//
// Colors stay on the muted/semantic ladder. Per DESIGN.md the lavender accent
// (--color-primary) is scarce — it is reserved for the primary CTA, focus ring,
// and the single high-priority card dot, NOT for status chrome.
// ============================================================================

export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "on_hold",
  "completed",
  "archived",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

// Muted, calm hues — never the lavender accent.
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  active: "var(--color-category-repurpose)", // green
  on_hold: "var(--color-category-generate)", // amber
  completed: "var(--color-category-research)", // blue
  archived: "var(--color-ink-tertiary)", // grey
};
