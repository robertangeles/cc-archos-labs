"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Client component for per-row admin actions on the Users list.
// Renders compact dropdown-style buttons:
//   - Promote to admin / Demote to member
//   - Deactivate / Reactivate
//
// Each action confirms (window.confirm) for destructive changes,
// PATCHes the corresponding /api/admin/users/[id]/* endpoint, and
// router.refresh()es the server component on success so the table
// reflects the new state without a full reload.

interface Props {
  userId: string;
  currentRole: string;
  currentActive: boolean;
}

export function UserRowActions({ userId, currentRole, currentActive }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function changeRole(newRole: "admin" | "member") {
    setError(null);
    if (currentRole === newRole) return;
    const promptText =
      newRole === "admin"
        ? "Promote this user to admin? They will get full backstage access."
        : "Demote this admin to member? They will lose backstage access.";
    if (typeof window !== "undefined" && !window.confirm(promptText)) return;

    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not change role.");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function setActive(active: boolean) {
    setError(null);
    if (currentActive === active) return;
    const promptText = active
      ? "Reactivate this user? They will be able to sign in again."
      : "Deactivate this user? All their active sessions will be revoked and they will not be able to sign in.";
    if (typeof window !== "undefined" && !window.confirm(promptText)) return;

    const res = await fetch(`/api/admin/users/${userId}/active`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not update user.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-end gap-y-1">
      <div className="flex items-center gap-x-1">
        {currentRole === "member" ? (
          <ActionButton
            onClick={() => changeRole("admin")}
            disabled={isPending}
            label="Make admin"
          />
        ) : (
          <ActionButton
            onClick={() => changeRole("member")}
            disabled={isPending}
            label="Demote"
          />
        )}
        {currentActive ? (
          <ActionButton
            onClick={() => setActive(false)}
            disabled={isPending}
            label="Deactivate"
            variant="danger"
          />
        ) : (
          <ActionButton
            onClick={() => setActive(true)}
            disabled={isPending}
            label="Reactivate"
          />
        )}
      </div>
      {error ? (
        <p className="max-w-[180px] text-right text-[11px] text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  label,
  variant = "default",
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  variant?: "default" | "danger";
}) {
  const cls =
    variant === "danger"
      ? "border-red-200 text-red-700 hover:bg-red-50"
      : "border-hairline text-ink-subtle hover:bg-surface-1 hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
}
