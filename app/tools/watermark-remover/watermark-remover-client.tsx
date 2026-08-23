"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  stripImage,
  MAX_IMAGE_SIZE_BYTES,
  UnsupportedFileTypeError,
  CorruptedImageError,
  type ImageStripResult,
} from "@/lib/image-metadata";
import { stripText, MAX_TEXT_LENGTH } from "@/lib/text-metadata";
import {
  trackWatermarkParseCompleted,
  trackWatermarkParseFailed,
} from "@/lib/watermark-analytics";
import { ImageDropzone } from "./image-dropzone";
import { ResultsPanel } from "./results-panel";

type Mode = "text" | "image";

type ImageState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      result: ImageStripResult;
      previewUrl: string;
      originalName: string;
    }
  | { status: "error"; message: string };

function minDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultHeadline(findingsCount: number, partial: boolean): string {
  if (partial) return "Partly cleaned";
  if (findingsCount === 0) return "Nothing hidden found";
  return `Removed ${findingsCount} signal${findingsCount === 1 ? "" : "s"}`;
}

function resultSubtext(findingsCount: number, partial: boolean): string {
  if (partial) return "Some signals could not be safely removed — see below.";
  if (findingsCount === 0) return "This file is already clean.";
  return "Here's exactly what was found and removed.";
}

export function WatermarkRemoverClient() {
  const [mode, setMode] = useState<Mode>("text");
  const textareaId = useId();

  // Text mode — recomputed live on every keystroke (synchronous, sub-ms).
  const [text, setText] = useState("");
  const textResult = text.length > 0 && text.length <= MAX_TEXT_LENGTH ? stripText(text) : null;
  const textTooLarge = text.length > MAX_TEXT_LENGTH;
  const [textFileError, setTextFileError] = useState<string | null>(null);
  const [textDragOver, setTextDragOver] = useState(false);

  const handleTextFile = useCallback(async (file: File) => {
    const isTextFile = file.type.startsWith("text/") || /\.(txt|md|markdown)$/i.test(file.name);
    if (!isTextFile) {
      setTextFileError(
        "That doesn't look like a text file — try a .txt or .md file, or paste the text directly.",
      );
      return;
    }
    try {
      setText(await file.text());
      setTextFileError(null);
    } catch {
      setTextFileError("We couldn't read this file — try pasting the text instead.");
    }
  }, []);

  // Image mode.
  const [imageState, setImageState] = useState<ImageState>({ status: "idle" });
  const generationRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const handleImageFile = useCallback(async (file: File) => {
    const myGeneration = ++generationRef.current;
    setImageState({ status: "loading" });

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setImageState({
        status: "error",
        message: "This file is larger than we can safely process in your browser (25 MB max) — try a smaller export.",
      });
      trackWatermarkParseFailed("image");
      return;
    }

    let bytes: Uint8Array;
    try {
      const [buf] = await Promise.all([file.arrayBuffer(), minDelay(300)]);
      bytes = new Uint8Array(buf);
    } catch {
      if (myGeneration !== generationRef.current) return;
      setImageState({
        status: "error",
        message: "We couldn't read this file. Your original file wasn't touched.",
      });
      trackWatermarkParseFailed("image");
      return;
    }
    if (myGeneration !== generationRef.current) return;

    let result: ImageStripResult;
    try {
      result = stripImage(bytes);
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      const message =
        err instanceof UnsupportedFileTypeError
          ? "That's not a JPEG or PNG file. WebP and HEIC aren't supported yet — try converting to JPEG or PNG."
          : err instanceof CorruptedImageError
            ? "We couldn't read this file — it may be corrupted or incomplete. Your original file wasn't touched."
            : "Something went wrong while reading this file. Your original file wasn't touched.";
      setImageState({ status: "error", message });
      trackWatermarkParseFailed("image");
      return;
    }

    const mime = result.format === "jpeg" ? "image/jpeg" : "image/png";
    const blob = new Blob([result.cleaned], { type: mime });

    // Decode-verify: never show success on a file that doesn't actually
    // decode (Eng Review Findings — a parser bug must never silently hand
    // back a corrupted "cleaned" file).
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (myGeneration !== generationRef.current) return;
    if (!bitmap) {
      setImageState({
        status: "error",
        message: "Something went wrong while cleaning this file. Your original file wasn't touched.",
      });
      trackWatermarkParseFailed("image");
      return;
    }
    bitmap.close();

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(blob);
    previewUrlRef.current = previewUrl;

    setImageState({ status: "success", result, previewUrl, originalName: file.name });
    trackWatermarkParseCompleted({
      source: result.format,
      findingsCount: result.findings.length,
      stripped: result.findings.length > 0,
    });
  }, []);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setText("");
    setTextFileError(null);
    setImageState({ status: "idle" });
    generationRef.current++; // invalidate any in-flight image parse
  }

  return (
    <div className="mx-auto max-w-[960px] px-6 py-16">
      <h1 className="text-display-md text-ink">Watermark Remover</h1>
      <p className="mt-3 max-w-xl text-body-lg text-ink-subtle">
        AI tools increasingly leave invisible signals in what they help you make — hidden
        characters in text, provenance metadata in photos. Paste or drop a file below to see
        what&rsquo;s there and remove it, entirely in your browser.
      </p>

      <div
        role="tablist"
        aria-label="Input type"
        className="mt-8 inline-flex gap-x-1 rounded-full border border-hairline bg-canvas p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => switchMode("text")}
          className={`rounded-full px-4 py-1.5 text-button transition-colors duration-150 ${
            mode === "text" ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
          }`}
        >
          Text
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "image"}
          onClick={() => switchMode("image")}
          className={`rounded-full px-4 py-1.5 text-button transition-colors duration-150 ${
            mode === "image" ? "bg-surface-2 text-ink" : "text-ink-subtle hover:text-ink"
          }`}
        >
          Image
        </button>
      </div>

      <div className="mt-6">
        {mode === "text" ? (
          <div>
            <label htmlFor={textareaId} className="sr-only">
              Paste text to check for hidden AI watermarks
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setTextDragOver(true);
              }}
              onDragLeave={() => setTextDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setTextDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleTextFile(file);
              }}
            >
              <textarea
                id={textareaId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste AI-generated text here, or drop a .txt/.md file…"
                rows={8}
                className={`w-full rounded-lg border bg-surface-1 p-4 text-body text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none ${
                  textDragOver ? "border-primary bg-surface-2" : "border-hairline"
                }`}
              />
            </div>
            <label
              htmlFor="watermark-text-file-input"
              className="mt-2 inline-block cursor-pointer text-body-sm text-primary underline underline-offset-2 transition-colors duration-150 hover:text-primary-hover"
            >
              Or upload a .txt/.md file
              <input
                id="watermark-text-file-input"
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleTextFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {textFileError ? (
              <p className="mt-2 text-body-sm text-semantic-error" role="alert">
                {textFileError}
              </p>
            ) : null}
            {textTooLarge ? (
              <p className="mt-2 text-body-sm text-semantic-error">
                That&rsquo;s more text than we can check at once — try a shorter piece.
              </p>
            ) : null}
            {textResult ? (
              <div className="mt-4">
                <ResultsPanel
                  headline={resultHeadline(textResult.findings.length, false)}
                  subtext={resultSubtext(textResult.findings.length, false)}
                  findings={textResult.findings}
                  partial={false}
                  primaryActionLabel="Copy cleaned text"
                  onPrimaryAction={() => {
                    navigator.clipboard?.writeText(textResult.cleaned).catch(() => {
                      // Clipboard write failed (permissions, insecure context,
                      // etc.) — the cleaned text is already visible and
                      // selectable in the textarea above as a manual fallback.
                    });
                  }}
                  removalLog={{
                    source: "text",
                    findings: textResult.findings,
                    generatedAt: new Date().toISOString(),
                  }}
                  removalLogFilename="watermark-removal-log.json"
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <ImageDropzone
              onFile={handleImageFile}
              disabled={imageState.status === "loading"}
            />
            {imageState.status === "loading" ? (
              <p className="mt-4 text-body-sm text-ink-subtle" role="status">
                Checking your photo…
              </p>
            ) : null}
            {imageState.status === "error" ? (
              <p className="mt-4 rounded-md border border-semantic-error/40 bg-semantic-error/10 px-3 py-2 text-body-sm text-semantic-error" role="alert">
                {imageState.message}
              </p>
            ) : null}
            {imageState.status === "success" ? (
              <div className="mt-4">
                <ResultsPanel
                  headline={resultHeadline(
                    imageState.result.findings.length,
                    imageState.result.partial,
                  )}
                  subtext={resultSubtext(
                    imageState.result.findings.length,
                    imageState.result.partial,
                  )}
                  findings={imageState.result.findings}
                  partial={imageState.result.partial}
                  partialReason={imageState.result.partialReason}
                  primaryActionLabel="Download cleaned photo"
                  onPrimaryAction={() => {
                    const a = document.createElement("a");
                    a.href = imageState.previewUrl;
                    a.download = `cleaned-${imageState.originalName}`;
                    a.click();
                  }}
                  removalLog={{
                    source: imageState.result.format,
                    findings: imageState.result.findings,
                    partial: imageState.result.partial,
                    generatedAt: new Date().toISOString(),
                  }}
                  removalLogFilename="watermark-removal-log.json"
                  imagePreviewUrl={imageState.previewUrl}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
