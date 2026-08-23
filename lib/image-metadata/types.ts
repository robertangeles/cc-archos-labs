export type ImageFormat = "jpeg" | "png";

export interface ImageStripResult {
  format: ImageFormat;
  cleaned: Uint8Array<ArrayBuffer>;
  findings: import("../watermark-finding").Finding[];
  // true when the parser could not confirm it walked the entire header
  // (hit the iteration cap) — some signals may remain undetected.
  partial: boolean;
  partialReason?: string;
}

export class UnsupportedFileTypeError extends Error {
  constructor(message = "That's not a JPEG or PNG file") {
    super(message);
    this.name = "UnsupportedFileTypeError";
  }
}

export class CorruptedImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptedImageError";
  }
}
