"use client";

import { useState } from "react";

const DISMISSED_KEY = "brain-onboarding-dismissed";

interface BrainOnboardingBannerProps {
  messageCount: number;
  brainProvisioned: boolean;
}

function getInitialDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(DISMISSED_KEY) === "true";
}

export function BrainOnboardingBanner({
  messageCount,
  brainProvisioned,
}: BrainOnboardingBannerProps) {
  const [dismissed, setDismissed] = useState(getInitialDismissed);

  if (dismissed || brainProvisioned || messageCount < 3) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  return (
    <div className="mx-4 mb-3 flex items-center gap-3 px-4 py-3
                    bg-[#141516] border border-[#23252a] rounded-lg
                    border-l-[3px] border-l-[#5e6ad2]">
      <p className="flex-1 text-sm text-[#d0d6e0]">
        Your AI brain is ready. It&apos;ll remember what matters across sessions.
      </p>
      <button
        onClick={handleDismiss}
        className="text-[#62666d] hover:text-[#8a8f98] transition-colors p-1"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
