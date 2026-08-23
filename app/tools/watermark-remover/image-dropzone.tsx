"use client";

import { useRef, useState } from "react";

// Labeled, focusable, native <input type="file">-backed control — not a bare
// drag-and-drop div. Tab-reachable, Enter/Space-activatable (native label+
// input semantics), and it's the same control mobile taps to open the OS
// picker — one control satisfies both the accessibility gap and the mobile
// tap-to-select requirement (design doc, Eng Review Findings).
export function ImageDropzone({
  onFile,
  disabled,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      htmlFor="watermark-image-input"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-y-2 rounded-lg border border-dashed px-6 py-12 text-center transition-colors duration-150 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-canvas ${
        isDragOver ? "border-primary bg-surface-2" : "border-hairline-strong bg-surface-1"
      } ${disabled ? "pointer-events-none opacity-50" : "hover:border-primary"}`}
    >
      <input
        ref={inputRef}
        id="watermark-image-input"
        type="file"
        accept="image/jpeg,image/png"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Allow re-selecting the same file twice in a row.
          e.target.value = "";
        }}
      />
      <span className="text-body font-medium text-ink">
        Drop a JPEG or PNG, or tap to choose one
      </span>
      <span className="text-body-sm text-ink-subtle">Never uploaded — processed on your device</span>
    </label>
  );
}
