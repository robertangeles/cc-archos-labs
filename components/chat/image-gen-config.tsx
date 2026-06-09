"use client";

import type { AspectRatio, ImageSize } from "@/lib/image-gen/service";

const ASPECT_RATIOS: Array<{ value: AspectRatio; label: string }> = [
  { value: "1:1", label: "Square (1:1)" },
  { value: "2:3", label: "Portrait (2:3)" },
  { value: "3:4", label: "Portrait tall (3:4)" },
  { value: "4:5", label: "Portrait narrow (4:5)" },
  { value: "9:16", label: "Phone (9:16)" },
  { value: "3:2", label: "Landscape (3:2)" },
  { value: "4:3", label: "Landscape wide (4:3)" },
  { value: "5:4", label: "Landscape narrow (5:4)" },
  { value: "16:9", label: "Widescreen (16:9)" },
  { value: "21:9", label: "Ultrawide (21:9)" },
];

const IMAGE_SIZES: Array<{ value: ImageSize; label: string }> = [
  { value: "1K", label: "Standard (1K)" },
  { value: "2K", label: "High (2K)" },
  { value: "4K", label: "Ultra (4K)" },
];

interface ImageGenConfigProps {
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  onAspectRatioChange: (value: AspectRatio) => void;
  onImageSizeChange: (value: ImageSize) => void;
}

export function ImageGenConfig({
  aspectRatio,
  imageSize,
  onAspectRatioChange,
  onImageSizeChange,
}: ImageGenConfigProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <select
        value={aspectRatio}
        onChange={(e) => onAspectRatioChange(e.target.value as AspectRatio)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[12px] text-neutral-300 outline-none focus:border-violet-500/50"
      >
        {ASPECT_RATIOS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <select
        value={imageSize}
        onChange={(e) => onImageSizeChange(e.target.value as ImageSize)}
        className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-[12px] text-neutral-300 outline-none focus:border-violet-500/50"
      >
        {IMAGE_SIZES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
