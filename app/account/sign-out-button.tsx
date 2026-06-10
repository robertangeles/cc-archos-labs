"use client";

export function SignOutButton() {

  async function onLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network error — clear cookie client-side as fallback
      document.cookie = "archos_session=; Max-Age=0; path=/";
    }
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
