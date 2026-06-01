"use client";

import { useEffect, useState } from "react";

interface ProgressBarProps {
  current: number;
  total: number;
  timerEnabled: boolean;
  timerSeconds: number;
  onTimerExpired: () => void;
}

export function ExamProgressBar({
  current,
  total,
  timerEnabled,
  timerSeconds,
  onTimerExpired,
}: ProgressBarProps) {
  const [remaining, setRemaining] = useState(timerSeconds);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync remaining when timerSeconds prop changes
    if (timerEnabled && timerSeconds > 0) setRemaining(timerSeconds);
  }, [timerEnabled, timerSeconds]);

  useEffect(() => {
    if (!timerEnabled || remaining <= 0) {
      if (timerEnabled && remaining <= 0) onTimerExpired();
      return;
    }
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timerEnabled, remaining, onTimerExpired]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeWarning = timerEnabled && remaining < 300 && remaining > 0;

  return (
    <div className="sticky top-0 z-20 border-b border-hairline bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[720px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-ink">
            {current} / {total}
          </span>
          <span className="text-xs text-ink-subtle">{percent}%</span>
        </div>

        {timerEnabled && (
          <span
            className={`font-mono text-sm font-medium ${
              timeWarning ? "text-red-600" : "text-ink-subtle"
            }`}
          >
            {String(minutes).padStart(2, "0")}:
            {String(seconds).padStart(2, "0")}
          </span>
        )}
      </div>

      <div className="h-0.5 bg-ink-subtle/10">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
