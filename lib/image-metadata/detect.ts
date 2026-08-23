import type { ImageFormat } from "./types";

const JPEG_SOI = [0xff, 0xd8];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Magic-byte detection only — never trust file.type or a filename
// extension, both are attacker/user-controlled hints, not proof of format.
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 2 && bytes[0] === JPEG_SOI[0] && bytes[1] === JPEG_SOI[1]) {
    return "jpeg";
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  return null;
}
