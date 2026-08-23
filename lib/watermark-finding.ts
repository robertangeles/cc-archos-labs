// Shared result shape for both text and image stripping (lib/text-metadata.ts,
// lib/image-metadata/*). One format-agnostic type so the UI (results screen,
// diff view, removal log) doesn't need parallel branches per source type.

export interface Finding {
  id: string;
  label: string;
  detail?: string;
}
