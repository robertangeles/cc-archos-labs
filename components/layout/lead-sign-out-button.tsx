"use client";

import { useRouter } from "next/navigation";

// "Sign out" menu item rendered inside the header Profile dropdown.
// Lives as its own component because it's the only client-side
// mutation in the header tree. Mirrors app/admin/(authed)/
// sign-out-button.tsx for the admin session.

export function LeadSignOutButton() {
  const router = useRouter();

  async function onLogout() {
    await fetch("/api/auth/lead/logout", { method: "POST" });
    // Refresh in place so the header re-renders without the signed-in
    // state. Don't redirect — the user might be mid-flow on a page
    // that's still useful (e.g. /tools/ai-readiness assessment SPA).
    router.refresh();
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onLogout}
      className="block w-full rounded px-3 py-2 text-left text-sm text-muted transition-colors duration-150 hover:bg-canvas hover:text-fg"
    >
      Sign out
    </button>
  );
}
