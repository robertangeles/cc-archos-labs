"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LeadSignOutButton } from "./lead-sign-out-button";
import { useOpenSearch } from "../search/search-provider";

const TOPLEVEL = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/consulting", label: "Consulting" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
];

const TOOLS = [
  { href: "/tools/ai-readiness", label: "AI Readiness Assessment" },
  { href: "/tools/cdmp-practice", label: "CDMP Practice Exam" },
  { href: "/tools/watermark-remover", label: "Watermark Remover" },
];

export interface NavLeadProps {
  firstName: string;
}

function AuthControl({ lead }: { lead: NavLeadProps | null }) {
  if (!lead) {
    return (
      <Link
        href="/login"
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
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="block rounded px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-canvas"
          >
            {firstName}
            <span className="block text-[11px] font-normal text-ink-subtle">Your account</span>
          </Link>
          <Link
            href="/account/workspace"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="block rounded px-3 py-2 text-sm text-ink-subtle transition-colors duration-150 hover:bg-canvas hover:text-ink"
          >
            Metis Workspace
          </Link>
          <div className="my-1 border-t border-hairline" />
          <LeadSignOutButton />
        </div>
      ) : null}
    </div>
  );
}

function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

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
              onClick={(e) => {
                setOpen(false);
                // A Next <Link> to the page you're already on is a no-op, which
                // leaves a heavy client-state tool (e.g. a finished CDMP exam)
                // stuck on its results. Force a fresh load so the tool resets.
                if (tool.href === pathname) {
                  e.preventDefault();
                  window.location.href = tool.href;
                }
              }}
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

function SearchButton() {
  const openSearch = useOpenSearch();
  if (!openSearch) return null;
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label="Search"
      className="text-ink-subtle transition-colors duration-150 hover:text-ink"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
        />
      </svg>
    </button>
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
      <SearchButton />
      <AuthControl lead={lead} />
    </nav>
  );
}
