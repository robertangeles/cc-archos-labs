"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  async function onLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={onLogout}
      className="text-sm text-muted transition-colors duration-150 hover:text-fg"
    >
      Sign out
    </button>
  );
}
