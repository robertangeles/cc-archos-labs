import "server-only";
import { extractPdf, extractDocx, isLikelyScanned } from "@/lib/extract-text";

// Text extraction for chat Attach Files. Dispatches by file type, bounds the
// work with a timeout (F2 DoS guard), detects scanned PDFs, and maps every
// outcome to a status + a plain-language message.

export const ALLOWED_EXTENSIONS = ["pdf", "txt", "md", "docx"] as const;
export const ALLOWED_MIME = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

// 50MB — matches the shipped kanban/contract upload ceiling (accepted OOM risk
// per eng review; text docs are far smaller in practice).
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// F2: bound extraction so a crafted file can't hang the request.
export const EXTRACT_TIMEOUT_MS = 15_000;
// Guard against extraction blow-up (zip-bomb-style huge text).
export const MAX_EXTRACTED_CHARS = 2_000_000;

export type ExtractStatus = "ready" | "unsupported" | "failed";

export interface ExtractResult {
  status: ExtractStatus;
  extractedText: string; // "" unless status === "ready"
  charCount: number;
  errorReason: string | null; // scanned_pdf | too_large | extract_failed | unsupported_type
  message: string | null; // user-facing plain-language message (null when ready)
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("extract_timeout")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isAllowedExtension(fileName: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(
    extensionOf(fileName),
  );
}

/**
 * Extract text from an uploaded document. Never throws — every failure maps to
 * a status + message the caller records on the document row and shows the user.
 */
export async function extractDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractResult> {
  const ext = extensionOf(fileName);
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      status: "unsupported",
      extractedText: "",
      charCount: 0,
      errorReason: "unsupported_type",
      message: "Unsupported file type. Allowed: PDF, TXT, MD, DOCX.",
    };
  }

  try {
    let text: string;
    if (ext === "txt" || ext === "md") {
      text = buffer.toString("utf8");
    } else if (ext === "pdf") {
      const { text: pdfText, numPages } = await withTimeout(
        extractPdf(buffer),
        EXTRACT_TIMEOUT_MS,
      );
      if (isLikelyScanned(pdfText, numPages)) {
        return {
          status: "unsupported",
          extractedText: "",
          charCount: 0,
          errorReason: "scanned_pdf",
          message: "This PDF looks scanned. Image support is coming.",
        };
      }
      text = pdfText;
    } else {
      // docx
      text = await withTimeout(extractDocx(buffer), EXTRACT_TIMEOUT_MS);
    }

    text = text.trim();
    if (text.replace(/\s+/g, "").length < 1) {
      return {
        status: "unsupported",
        extractedText: "",
        charCount: 0,
        errorReason: "extract_failed",
        message: "Couldn't read any text from this file.",
      };
    }
    if (text.length > MAX_EXTRACTED_CHARS) {
      text = text.slice(0, MAX_EXTRACTED_CHARS);
    }
    return {
      status: "ready",
      extractedText: text,
      charCount: text.length,
      errorReason: null,
      message: null,
    };
  } catch {
    // Timeout or a malformed file — never surface the raw error.
    return {
      status: "failed",
      extractedText: "",
      charCount: 0,
      errorReason: "extract_failed",
      message: "Couldn't read this file.",
    };
  }
}
