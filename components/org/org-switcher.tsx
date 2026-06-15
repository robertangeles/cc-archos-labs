"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown } from "lucide-react";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

// The active org is not exposed by the API — it lives in an httpOnly cookie
// resolved server-side. The list comes back ordered newest-first, which is the
// same ordering resolveOrgContext() uses to pick the default org, so the first
// entry is the best client-side approximation of "the current org".
export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/organisations")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.ok) return;
        const list: OrgSummary[] = data.organisations ?? [];
        setOrgs(list);
        setActiveId(list[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Close the menu on outside click (mirrors the header's ProfileMenu).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  async function selectOrg(orgId: string) {
    if (orgId === activeId || switching) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch("/api/organisations/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        setActiveId(orgId);
        setOpen(false);
        router.refresh();
      }
    } catch {
      // Surface nothing technical; the menu stays open so the user can retry.
    } finally {
      setSwitching(false);
    }
  }

  // Nothing to show while loading or when the user has no orgs.
  if (loading || orgs.length === 0) return null;

  const active = orgs.find((o) => o.id === activeId) ?? orgs[0];

  // Single org — plain, non-interactive label. No chevron, no accent.
  if (orgs.length === 1) {
    return (
      <span className="flex items-center gap-x-1.5 text-sm text-ink-subtle">
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="max-w-[140px] truncate">{active.name}</span>
      </span>
    );
  }

  // Multiple orgs — a button that opens the switcher menu.
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex min-h-[44px] items-center gap-x-1.5 text-sm text-ink-subtle transition-colors duration-150 hover:text-ink"
      >
        <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="max-w-[140px] truncate">{active.name}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-3 w-max min-w-[200px] max-w-[calc(100vw-3rem)] rounded-md border border-hairline bg-surface-1 p-2 shadow-2xl sm:left-auto sm:right-0"
        >
          <p className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
            Switch organisation
          </p>
          {orgs.map((org) => {
            const isActive = org.id === active.id;
            return (
              <button
                key={org.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                disabled={switching}
                onClick={() => selectOrg(org.id)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-x-3 rounded px-3 py-2 text-left text-sm transition-colors duration-150 disabled:opacity-60 ${
                  isActive
                    ? "text-primary"
                    : "text-ink-subtle hover:bg-canvas hover:text-ink"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{org.name}</span>
                {isActive ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
