"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LeadSignOutButton } from "./lead-sign-out-button";

const TOPLEVEL = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const TOOLS = [
  { href: "/tools/ai-readiness", label: "AI Readiness Assessment" },
];

export interface NavLeadProps {
  firstName: string;
}

function AuthControl({ lead }: { lead: NavLeadProps | null }) {
  if (!lead) {
    return (
      <Link
        href="/sign-in"
        className="transition-colors duration-150 hover:text-ink"
      >
        Sign in
      </Link>
    );
  }
  return <ProfileMenu firstName={lead.firstName} />;
}

function ProfileMenu({ firstName }: { firstName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-x-1 transition-colors duration-150 hover:text-ink"
      >
        Profile
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-3 w-max min-w-[200px] max-w-[calc(100vw-3rem)] rounded-md border border-hairline bg-surface-1 p-2 shadow-2xl"
        >
          {/* Identity row — non-interactive label so the user knows
              which account they're signed in as. Stays at the top so
              future menu items (Account, Settings) read below it. */}
          <p className="px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-ink-subtle/70">
            Signed in as
          </p>
          <p className="px-3 pb-2 text-sm font-medium text-ink">
            {firstName}
          </p>
          <div className="my-1 border-t border-hairline" />
          {/* Future profile menu items slot in here. When the profile
              page exists, add a "Your account" Link above Sign out. */}
          <LeadSignOutButton />
        </div>
      ) : null}
    </div>
  );
}

function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-x-1 transition-colors duration-150 hover:text-ink"
      >
        Tools
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-3 w-max max-w-[calc(100vw-3rem)] rounded-md border border-hairline bg-surface-1 p-2 shadow-2xl sm:left-auto sm:right-0"
        >
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2 text-sm text-ink-subtle transition-colors duration-150 hover:bg-canvas hover:text-ink"
            >
              {tool.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Nav({ lead }: { lead: NavLeadProps | null }) {
  return (
    <nav className="flex items-center gap-x-5 text-sm text-ink-subtle sm:gap-x-7">
      {TOPLEVEL.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="transition-colors duration-150 hover:text-ink"
        >
          {label}
        </Link>
      ))}
      <ToolsMenu />
      <AuthControl lead={lead} />
    </nav>
  );
}
