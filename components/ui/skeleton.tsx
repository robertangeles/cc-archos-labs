// Pulsing placeholder blocks for loading states (plan §17.9). Three
// variants match the surfaces that need them on /book:
//
//   "day"  — 40×40px square, used in the calendar grid while month data
//            loads
//   "slot" — full-width 44px row, used in the slot list while slots load
//   "line" — generic single-line block; pass `widthClass` to size it
//
// `prefers-reduced-motion: reduce` suppresses the pulse via Tailwind's
// motion-safe modifier — falls back to a static block.

type Variant = "day" | "slot" | "line";

const variantClass: Record<Variant, string> = {
  day: "h-10 w-10 rounded-md",
  slot: "h-11 w-full rounded-md",
  line: "h-4 rounded",
};

export interface SkeletonProps {
  variant?: Variant;
  className?: string;
  // For variant="line", set a width Tailwind utility (e.g. "w-32").
  widthClass?: string;
}

export function Skeleton({
  variant = "line",
  className = "",
  widthClass = "",
}: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`bg-surface-1 motion-safe:animate-pulse ${variantClass[variant]} ${widthClass} ${className}`}
    />
  );
}
