// Public entry point for image metadata stripping. Uint8Array in, Uint8Array
// out, zero DOM/Node-specific APIs anywhere in this module or the ones it
// imports — see docs/designs/watermark-remover.md Approach C for why.

import { detectFormat } from "./detect";
import { stripJpeg } from "./jpeg";
import { stripPng } from "./png";
import { UnsupportedFileTypeError, type ImageStripResult } from "./types";

// design doc "Must resolve before v1 ships" — file-size ceiling, tested
// against the parser-verification spike fixtures on real low-RAM devices.
export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;

export function stripImage(bytes: Uint8Array): ImageStripResult {
  const format = detectFormat(bytes);
  if (format === "jpeg") return stripJpeg(bytes);
  if (format === "png") return stripPng(bytes);
  throw new UnsupportedFileTypeError();
}

export { detectFormat } from "./detect";
export { UnsupportedFileTypeError, CorruptedImageError } from "./types";
export type { ImageFormat, ImageStripResult } from "./types";
