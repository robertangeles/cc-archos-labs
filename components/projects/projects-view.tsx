"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { FolderKanban, Plus, Loader2, Building2 } from "lucide-react";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  type ProjectStatus,
} from "./status";

// ============================================================================
// ProjectsView — the projects list. Mirrors the skills-list visual language:
// Framer Motion stagger, a colored left-border card keyed to project status, an
// accent-tint empty state, and skeleton loaders. A "New project" panel POSTs to
// /api/projects with an optional client picker sourced from /api/clients.
//
// All access control lives server-side; this view reads + creates. Errors shown
// to the user are plain language — never a raw exception.
// ============================================================================

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  clientId: string | null;
  clientName: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientOption {
  id: string;
  name: string;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function statusColor(status: string): string {
  return PROJECT_STATUS_COLORS[status as ProjectStatus] ?? "var(--color-hairline)";
}

function statusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status;
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

// Field bounds copied from lib/projects/validation.ts (the server source).
const NAME_MAX = 255;
const DESCRIPTION_MAX = 20000;

const FIELD_STYLES =
  "mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const LABEL_STYLES =
  "block text-xs font-medium uppercase tracking-wider text-ink-subtle";

export function ProjectsView() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Projects drive the list. `loading` already starts true, so all state
    // updates here happen inside async callbacks — never synchronously in the
    // effect body.
    fetch("/api/projects", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
    // Clients are optional; a failure just means no picker, not a broken page.
    fetch("/api/clients", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => setClients([]));
  }, []);

  function handleCreated(project: ProjectSummary) {
    setProjects((prev) => [project, ...prev]);
    setCreating(false);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[72px] animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[11px] text-ink-tertiary">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </p>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            New project
          </button>
        )}
      </div>

      {creating && (
        <NewProjectForm
          clients={clients}
          onCreated={handleCreated}
          onCancel={() => setCreating(false)}
        />
      )}

      {projects.length === 0 && !creating ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-ink-tertiary" />
          <h3 className="mt-4 text-sm font-medium text-ink">
            Create your first project
          </h3>
          <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
            A project is a board where you plan and track delivery work, column
            by column. Start one to get going.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {projects.map((p, i) => (
            <motion.li
              key={p.id}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
            >
              <Link
                href={`/account/projects/${p.id}`}
                className="group flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-3 transition-colors duration-150 hover:border-hairline-strong hover:bg-surface-2"
                style={{
                  borderLeftWidth: "3px",
                  borderLeftColor: statusColor(p.status),
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${statusColor(p.status)} 10%, transparent)`,
                      color: statusColor(p.status),
                    }}
                  >
                    <FolderKanban className="h-4 w-4" />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink transition-colors group-hover:text-primary-hover">
                      {p.name}
                    </span>
                    {p.clientName && (
                      <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
                        <Building2 className="h-3 w-3 shrink-0 text-ink-tertiary" />
                        {p.clientName}
                      </span>
                    )}
                    {p.description && (
                      <span className="line-clamp-1 text-xs text-ink-subtle">
                        {p.description}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${statusColor(p.status)} 12%, transparent)`,
                      color: statusColor(p.status),
                    }}
                  >
                    {statusLabel(p.status)}
                  </span>
                  <span className="text-[11px] text-ink-tertiary">
                    {formatDate(p.updatedAt)}
                  </span>
                </div>
              </Link>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- New project form ------------------------------------------------------

interface NewProjectFormProps {
  clients: ClientOption[];
  onCreated: (project: ProjectSummary) => void;
  onCancel: () => void;
}

function NewProjectForm({ clients, onCreated, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Give the project a name.");
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Keep the name under ${NAME_MAX} characters.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
          clientId: clientId || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not create the project. Please try again.");
        return;
      }
      onCreated(data.project as ProjectSummary);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 space-y-5 rounded-lg border border-hairline bg-surface-1 p-5"
    >
      <div>
        <label htmlFor="project-name" className={LABEL_STYLES}>
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Q3 Data Readiness Engagement"
          onChange={(e) => setName(e.target.value)}
          className={FIELD_STYLES}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="project-description" className={LABEL_STYLES}>
          Description
        </label>
        <textarea
          id="project-description"
          rows={3}
          value={description}
          maxLength={DESCRIPTION_MAX}
          placeholder="What this project covers. Optional."
          onChange={(e) => setDescription(e.target.value)}
          className={FIELD_STYLES}
        />
      </div>

      {clients.length > 0 && (
        <div>
          <label htmlFor="project-client" className={LABEL_STYLES}>
            Client
          </label>
          <select
            id="project-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={FIELD_STYLES}
          >
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3">
          <p className="text-sm text-semantic-error">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex min-h-11 items-center rounded-md border border-hairline bg-surface-1 px-4 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Create project
        </button>
      </div>
    </form>
  );
}
