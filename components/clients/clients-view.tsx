"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Building2, Plus, Search, X, ChevronLeft } from "lucide-react";
import { ClientDetail, type Client } from "./client-detail";
import {
  ClientForm,
  type ClientFormValues,
  EMPTY_CLIENT,
} from "./client-form";

// ============================================================================
// ClientsView — the consulting CRM shell.
//
// Desktop: two panes — a searchable client list on the left, the selected
// client's detail on the right. Mobile: a single column that swaps between the
// list and the detail (back button returns to the list).
//
// The API never tells the browser the caller's role. We therefore show the
// create/edit/delete affordances optimistically and, if a write returns 403,
// flip `canWrite` to false and surface a plain permission message. This is the
// graceful-degradation path the task calls for.
// ============================================================================

/** Trim every field so we send the same shape the server validation expects. */
function trimValues(values: ClientFormValues): ClientFormValues {
  const out = { ...values };
  (Object.keys(out) as Array<keyof ClientFormValues>).forEach((k) => {
    out[k] = out[k].trim();
  });
  return out;
}

const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      type: "spring" as const,
      stiffness: 100,
      damping: 10,
    },
  }),
};

export function ClientsView() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Optimistic: assume the caller may write until a 403 proves otherwise.
  const [canWrite, setCanWrite] = useState(true);

  // Load the org's clients once on mount. The setState calls live in promise
  // callbacks (not the synchronous effect body) so they don't trigger the
  // cascading-render lint rule — the same shape used by workflows-list.
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => {
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((data) => {
        setClients(data.clients ?? []);
        setLoadError(null);
      })
      .catch(() => {
        setLoadError("We couldn't load your clients. Please refresh.");
        setClients([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = clients.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.industry ?? "").toLowerCase().includes(q)
    );
  });

  const selected = clients.find((c) => c.id === selectedId) ?? null;

  /** Create a client. Returns a plain message on failure (form shows it). */
  async function handleCreate(values: ClientFormValues): Promise<string | void> {
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trimValues(values)),
    });
    if (res.status === 403) {
      setCanWrite(false);
      setCreating(false);
      return "You don't have permission to add clients.";
    }
    if (!res.ok) {
      return "We couldn't save this client. Check the fields and try again.";
    }
    const data = await res.json();
    if (data.client) {
      setClients((prev) => [data.client, ...prev]);
      setSelectedId(data.client.id);
    }
    setCreating(false);
  }

  /** Reflect an edit made in the detail pane back into the list. */
  function handleClientUpdated(updated: Client) {
    setClients((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c)),
    );
  }

  /** Drop a deleted client and clear the selection. */
  function handleClientDeleted(id: string) {
    setClients((prev) => prev.filter((c) => c.id !== id));
    setSelectedId(null);
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-6">
        <p className="uppercase text-eyebrow text-ink-tertiary">Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          Clients
        </h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Your consulting clients, their contacts, and their contracts.
        </p>
      </div>

      {/* ── Two-pane layout (stacks on mobile) ── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* Left pane: list. Hidden on mobile once a client is selected. */}
        <div className={selected ? "hidden lg:block" : "block"}>
          <ClientList
            clients={filtered}
            total={clients.length}
            loading={loading}
            loadError={loadError}
            query={query}
            onQuery={setQuery}
            selectedId={selectedId}
            onSelect={setSelectedId}
            canWrite={canWrite}
            onAdd={() => setCreating(true)}
          />
        </div>

        {/* Right pane: detail. On mobile this replaces the list. */}
        <div className={selected ? "block" : "hidden lg:block"}>
          {selected ? (
            <div>
              <button
                onClick={() => setSelectedId(null)}
                className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-subtle transition-colors hover:text-ink lg:hidden"
              >
                <ChevronLeft className="h-4 w-4" />
                All clients
              </button>
              <ClientDetail
                key={selected.id}
                client={selected}
                canWrite={canWrite}
                onPermissionDenied={() => setCanWrite(false)}
                onUpdated={handleClientUpdated}
                onDeleted={handleClientDeleted}
              />
            </div>
          ) : (
            <div className="hidden h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center lg:flex">
              <p className="text-sm text-ink-subtle">
                Select a client to see their details.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Add-client modal ── */}
      {creating && (
        <CreateClientModal
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// ClientList — the left pane: search box, count, "Add client", and the cards.
// ----------------------------------------------------------------------------

interface ClientListProps {
  clients: Client[];
  total: number;
  loading: boolean;
  loadError: string | null;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  onAdd: () => void;
}

function ClientList({
  clients,
  total,
  loading,
  loadError,
  query,
  onQuery,
  selectedId,
  onSelect,
  canWrite,
  onAdd,
}: ClientListProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[72px] animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-hairline bg-surface-1 px-6 py-12 text-center">
        <p className="text-sm text-ink-subtle">{loadError}</p>
      </div>
    );
  }

  // Empty state — accent-tinted, mirrors the skills-list empty pattern.
  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <span
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-primary) 10%, transparent)",
            color: "var(--color-primary)",
          }}
        >
          <Building2 className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-sm font-medium text-ink">No clients yet</h3>
        <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
          Add your first client to start tracking their contacts and contracts.
        </p>
        {canWrite ? (
          <button
            onClick={onAdd}
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            Add client
          </button>
        ) : (
          <p className="mt-5 text-xs text-ink-tertiary">
            You don&apos;t have permission to add clients.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Search + add */}
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search clients"
            className="block w-full rounded-md border border-hairline bg-surface-1 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {canWrite && (
          <button
            onClick={onAdd}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      <p className="mb-3 text-[11px] text-ink-tertiary">
        {clients.length} of {total} client{total === 1 ? "" : "s"}
      </p>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-10 text-center">
          <p className="text-sm text-ink-subtle">
            No clients match &ldquo;{query}&rdquo;.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {clients.map((c, i) => {
            const isActive = c.id === selectedId;
            return (
              <motion.li
                key={c.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
              >
                <button
                  onClick={() => onSelect(c.id)}
                  className={`group flex w-full items-center justify-between rounded-lg border bg-surface-1 px-5 py-3 text-left transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2 ${
                    isActive
                      ? "border-hairline-strong bg-surface-2"
                      : "border-hairline"
                  }`}
                  style={{
                    borderLeftWidth: "3px",
                    borderLeftColor: isActive
                      ? "var(--color-primary)"
                      : "var(--color-hairline)",
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-primary) 10%, transparent)",
                        color: "var(--color-primary)",
                      }}
                    >
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className={`truncate text-sm font-medium transition-colors ${
                          isActive
                            ? "text-primary"
                            : "text-ink group-hover:text-primary-hover"
                        }`}
                      >
                        {c.name}
                      </span>
                      {c.industry && (
                        <span className="truncate text-xs text-ink-subtle">
                          {c.industry}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// CreateClientModal — a focused overlay wrapping ClientForm for the add flow.
// ----------------------------------------------------------------------------

interface CreateClientModalProps {
  onClose: () => void;
  onSubmit: (values: ClientFormValues) => Promise<string | void>;
}

function CreateClientModal({ onClose, onSubmit }: CreateClientModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-semantic-overlay/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Add client"
      onMouseDown={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="my-auto w-full max-w-2xl rounded-xl border border-hairline bg-surface-1 p-6 shadow-xl sm:p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Add client
            </h2>
            <p className="mt-1 text-sm text-ink-subtle">
              Only the name is required. You can fill in the rest later.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ClientForm
          initialValues={EMPTY_CLIENT}
          onSubmit={onSubmit}
          onCancel={onClose}
          submitLabel="Add client"
        />
      </motion.div>
    </div>
  );
}
