// Small muted line that lives directly under the hero H1 on /book.
// One-line trust-micro copy: "Free. 30 min. Google Meet. No follow-up
// sales pitch." Matches plan §17.3 body styling. Server component.

import type { ReactNode } from "react";

export interface TrustMicroProps {
  children: ReactNode;
  className?: string;
}

export function TrustMicro({ children, className = "" }: TrustMicroProps) {
  return (
    <p
      className={`text-[16px] leading-[1.6] text-ink-subtle ${className}`}
    >
      {children}
    </p>
  );
}
