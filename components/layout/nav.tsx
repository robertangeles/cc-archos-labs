"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LeadSignOutButton } from "./lead-sign-out-button";

const TOPLEVEL = [
  { href: "/", label: "Home" },
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
        className="transition-colors duration-150 hover:text-fg"
      >
        Sign in
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-x-3">
      <span className="hidden text-muted/80 sm:inline">
        Hi, {lead.firstName}
      </span>
      <LeadSignOutButton />
    </span>
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
        className="flex items-center gap-x-1 transition-colors duration-150 hover:text-fg"
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
          className="absolute left-0 z-50 mt-3 w-max max-w-[calc(100vw-3rem)] rounded-md border border-rule bg-surface p-2 shadow-2xl sm:left-auto sm:right-0"
        >
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-canvas hover:text-fg"
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
    <nav className="flex items-center gap-x-5 text-sm text-muted sm:gap-x-7">
      {TOPLEVEL.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="transition-colors duration-150 hover:text-fg"
        >
          {label}
        </Link>
      ))}
      <ToolsMenu />
      <AuthControl lead={lead} />
    </nav>
  );
}
