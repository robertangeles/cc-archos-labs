"use client";

import { useRouter } from "next/navigation";

// "Sign out" button in the site header for return visitors signed in
// via magic-link or registration. Mirrors app/admin/(authed)/
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
      onClick={onLogout}
      className="transition-colors duration-150 hover:text-fg"
    >
      Sign out
    </button>
  );
}
