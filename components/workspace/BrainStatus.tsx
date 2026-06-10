"use client";

import { useEffect, useState } from "react";

interface BrainStatusProps {
  className?: string;
}

export function BrainStatus({ className = "" }: BrainStatusProps) {
  const [status, setStatus] = useState<{
    provisioned: boolean;
    serviceHealthy: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/brain/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStatus(data))
      .catch(() => setStatus(null));
  }, []);

  if (!status || !status.provisioned) return null;

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div
        className={`w-2 h-2 rounded-full ${
          status.serviceHealthy
            ? "bg-[#5e6ad2] animate-pulse"
            : "bg-[#62666d]"
        }`}
      />
      <span className="text-xs text-[#62666d]">Brain</span>
    </div>
  );
}
