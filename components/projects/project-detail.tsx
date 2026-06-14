"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Loader2,
  AlertCircle,
  Activity as ActivityIcon,
  LayoutGrid,
} from "lucide-react";
import { KanbanBoard } from "@/components/kanban/board";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  type ProjectStatus,
} from "./status";

// ============================================================================
// ProjectDetail — the project header + Board / Activity tabs. The header shows
// the name and status; an inline Edit panel PATCHes name + status. Edit/delete
// require owner|admin server-side — there is no client role endpoint, so the
// affordance is shown to everyone and a 403 surfaces the server's plain-language
// permission message rather than being hidden. The Board tab hosts the Kanban
// board; the Activity tab is the project's timeline, newest first.
// ============================================================================

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  clientId: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActivityEntry {
  id: string;
  projectId: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  createdAt: string;
}

const NAME_MAX = 255;

const FIELD_STYLES =
  "mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const LABEL_STYLES =
  "block text-xs font-medium uppercase tracking-wider text-ink-subtle";

function statusColor(status: string): string {
  return PROJECT_STATUS_COLORS[status as ProjectStatus] ?? "var(--color-hairline)";
}

function statusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status;
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Turn an activity row into a short human sentence. */
function describeActivity(a: ActivityEntry): string {
  const what = a.entityName ? ` “${a.entityName}”` : "";
  const noun = a.entityType ? ` ${a.entityType.replace(/_/g, " ")}` : "";
  const verbs: Record<string, string> = {
    created: "Created",
    updated: "Updated",
    deleted: "Deleted",
    moved: "Moved",
    added: "Added",
    removed: "Removed",
  };
  const verb = verbs[a.action] ?? a.action;
  return `${verb}${noun}${what}`.trim();
}

type Tab = "board" | "activity";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // `loadError` starts null and `loading` starts true, so every state update
    // here runs inside an async callback — never synchronously in the effect
    // body. `active` guards against a setState after unmount.
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (res.status === 404) {
          setLoadError("This project could not be found.");
          return;
        }
        if (!res.ok || !data?.ok) {
          setLoadError(
            data?.error ?? "Could not load the project. Please refresh.",
          );
          return;
        }
        setProject(data.project as Project);
      } catch {
        if (active) setLoadError("Could not load the project. Please refresh.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded-md bg-surface-1" />
        <div className="flex gap-4 overflow-x-auto">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-72 w-[300px] min-w-[300px] animate-pulse rounded-xl border border-hairline bg-surface-1"
            />
          ))}
        </div>
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div>
        <Link
          href="/account/projects"
          className="inline-flex items-center gap-1.5 text-sm text-ink-subtle transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          All projects
        </Link>
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-ink-tertiary" />
          <p className="text-sm text-ink-subtle">
            {loadError ?? "Project unavailable."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/account/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-subtle transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        All projects
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: `color-mix(in srgb, ${statusColor(project.status)} 12%, transparent)`,
                color: statusColor(project.status),
              }}
            >
              {statusLabel(project.status)}
            </span>
          </div>
          {project.description && (
            <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
              {project.description}
            </p>
          )}
        </div>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-hairline bg-surface-1 px-3 py-1.5 text-sm font-medium text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        )}
      </header>

      {editing && (
        <EditProjectForm
          project={project}
          onSaved={(p) => {
            setProject(p);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-1 border-b border-hairline">
        <TabButton
          active={tab === "board"}
          onClick={() => setTab("board")}
          icon={<LayoutGrid className="h-4 w-4" />}
          label="Board"
        />
        <TabButton
          active={tab === "activity"}
          onClick={() => setTab("activity")}
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Activity"
        />
      </div>

      <div className="mt-5">
        {tab === "board" ? (
          <KanbanBoard projectId={projectId} />
        ) : (
          <ActivityTimeline projectId={projectId} />
        )}
      </div>
    </div>
  );
}

// ---- Tab button ------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-ink"
          : "border-transparent text-ink-subtle hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---- Edit project form -----------------------------------------------------

function EditProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project: Project;
  onSaved: (p: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("The project needs a name.");
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Keep the name under ${NAME_MAX} characters.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim(),
          status,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 403) {
        setError(
          data?.error ??
            "You do not have permission to edit this project.",
        );
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not save changes. Please try again.");
        return;
      }
      onSaved(data.project as Project);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-5 rounded-lg border border-hairline bg-surface-1 p-5"
    >
      <div>
        <label htmlFor="edit-project-name" className={LABEL_STYLES}>
          Project name
        </label>
        <input
          id="edit-project-name"
          type="text"
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          className={FIELD_STYLES}
        />
      </div>

      <div>
        <label htmlFor="edit-project-description" className={LABEL_STYLES}>
          Description
        </label>
        <textarea
          id="edit-project-description"
          rows={3}
          value={description}
          maxLength={20000}
          onChange={(e) => setDescription(e.target.value)}
          className={FIELD_STYLES}
        />
      </div>

      <div>
        <label htmlFor="edit-project-status" className={LABEL_STYLES}>
          Status
        </label>
        <select
          id="edit-project-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={FIELD_STYLES}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

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
          Save changes
        </button>
      </div>
    </form>
  );
}

// ---- Activity timeline -----------------------------------------------------

function ActivityTimeline({ projectId }: { projectId: string }) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${projectId}/activity`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (!data?.ok) {
          setError("Could not load the activity feed.");
          return;
        }
        // The API already orders newest first; sort defensively just in case.
        const rows = (data.activity ?? []) as ActivityEntry[];
        rows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setActivity(rows);
      })
      .catch(() => {
        if (active) setError("Could not load the activity feed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-ink-tertiary" />
        <p className="text-sm text-ink-subtle">{error}</p>
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <ActivityIcon className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h3 className="mt-4 text-sm font-medium text-ink">No activity yet</h3>
        <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
          As work moves on the board, every change shows up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {activity.map((a) => (
        <li
          key={a.id}
          className="flex items-start justify-between gap-4 rounded-lg border border-hairline bg-surface-1 px-4 py-3"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-tertiary" />
            <p className="text-sm text-ink">{describeActivity(a)}</p>
          </div>
          <span className="shrink-0 text-[11px] text-ink-tertiary">
            {formatDateTime(a.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
