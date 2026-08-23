// Plain-English explanation shown when a user expands a finding — the
// "Detect & Explain" panel (design doc, Accepted Expansions #1).
export const FINDING_EXPLANATIONS: Record<string, string> = {
  zwsp: "An invisible character with no visual width. Some AI tools use it as a hidden fingerprint.",
  zwnj: "Controls whether adjacent characters visually join. Invisible on its own.",
  zwj: "Joins adjacent characters, such as emoji sequences. Invisible on its own.",
  "word-joiner": "Prevents a line break at this exact point. Invisible on its own.",
  bom: "A byte-order marker that can appear as an invisible character mid-text.",
  nnbsp: "A narrow space, subtly different from a normal space — used by some AI writing tools.",
  "em-space": "A wide space character, used by some AI writing tools in place of a normal space.",
  "thin-space": "A narrow space character, essentially invisible at normal reading size.",
  "bidi-control": "Controls left-to-right vs. right-to-left text direction. Invisible on its own.",
  "bidi-isolate": "Isolates a span of text for bidirectional-language rendering. Invisible on its own.",
  "variation-selector": "Selects a specific visual style of the character right before it.",
  "tag-block": "A rare Unicode character range that can carry hidden data invisibly.",
  exif: "Camera and device metadata — can include GPS location, camera model and serial number, and editing software.",
  xmp: "Adobe's metadata format — can include the creator's name and editing history.",
  c2pa: "A signed record of how this image was created or edited, including which AI tools were involved.",
};
