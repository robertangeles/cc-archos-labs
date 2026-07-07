import "server-only";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";

// Shared text-extraction primitives. The chat Attach Files feature composes
// these (lib/chat/attachments/extract.ts). scripts/ingest-pdf.mjs uses the same
// pdf-parse subpath directly — a future cleanup can route it through here too.

export interface PdfExtract {
  text: string;
  numPages: number;
}

export async function extractPdf(buffer: Buffer): Promise<PdfExtract> {
  const parsed = await pdfParse(buffer);
  return { text: parsed.text ?? "", numPages: parsed.numpages ?? 0 };
}

export async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

// A PDF with almost no extractable text is image-only (scanned) — it needs a
// vision pipeline, which is a fast-follow, not v1. Threshold: fewer than 100
// non-whitespace chars total, or fewer than ~10 non-whitespace chars per page.
export function isLikelyScanned(text: string, numPages: number): boolean {
  const nonWhitespace = text.replace(/\s+/g, "").length;
  if (nonWhitespace < 100) return true;
  if (numPages > 0 && nonWhitespace / numPages < 10) return true;
  return false;
}
