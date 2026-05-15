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
    // Navigate to home then refresh. Sign out from an owner-only page
    // (report, portal with signed-in state) would leave the user on a
    // URL that now 404s with the cookie gone — visually ambiguous
    // because the URL bar doesn't change. Home is always a safe
    // landing: works signed-in or signed-out, header re-renders to
    // show "Sign in" again.
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onLogout}
      className="block w-full rounded px-3 py-2 text-left text-sm text-ink-subtle transition-colors duration-150 hover:bg-canvas hover:text-ink"
    >
      Sign out
    </button>
  );
}
