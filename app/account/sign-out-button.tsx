"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      className="text-sm text-ink-subtle transition-colors hover:text-ink"
    >
      Sign out
    </button>
  );
}
