"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface BookingRowActionsProps {
  bookingId: string;
  currentStatus: string;
}

type ActionStatus = "idle" | "saving" | "error";

export function BookingRowActions({
  bookingId,
  currentStatus,
}: BookingRowActionsProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ActionStatus>("idle");

  async function flipStatus(newStatus: string) {
    if (status === "saving") return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  if (currentStatus === "cancelled" || currentStatus === "rescheduled_from") {
    return <span className="text-xs text-ink-subtle">—</span>;
  }

  return (
    <div className="flex items-center gap-x-2">
      {currentStatus === "confirmed" && (
        <>
          <ActionButton
            label="Completed"
            disabled={status === "saving"}
            onClick={() => flipStatus("completed")}
            className="text-semantic-success"
          />
          <ActionButton
            label="No show"
            disabled={status === "saving"}
            onClick={() => flipStatus("no_show")}
            className="text-semantic-error"
          />
        </>
      )}
      {currentStatus === "completed" && (
        <ActionButton
          label="Undo"
          disabled={status === "saving"}
          onClick={() => flipStatus("completed")}
          className="text-ink-subtle"
          title="Reset to confirmed"
        />
      )}
      {currentStatus === "no_show" && (
        <ActionButton
          label="Undo"
          disabled={status === "saving"}
          onClick={() => flipStatus("completed")}
          className="text-ink-subtle"
          title="Mark as completed instead"
        />
      )}
      {status === "error" && (
        <span className="text-[10px] text-semantic-error">Failed</span>
      )}
    </div>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
  className = "",
  title,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  );
}
