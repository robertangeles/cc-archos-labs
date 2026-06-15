"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  Trash2,
  MessageSquare,
  Clock,
  Paperclip,
  Tag,
  Plus,
  Send,
  Download,
  FileText,
} from "lucide-react";
import {
  type BoardCard,
  type ProjectMember,
  type CardLabel,
  type CardComment,
  type CardActivity,
  type CardAttachment,
  type OrgMember,
  CARD_PRIORITIES,
  PRIORITY_LABELS,
} from "./types";
import { DateField } from "@/components/ui/date-field";

// ============================================================================
// CardModal — the full card record across four tabs: Details, Comments,
// History, Attachments. Details PATCHes the card; the other tabs each own a
// resource (comments, project_activity, Cloudinary-backed attachments) and a
// label picker. Assignees are the current ORG's members. Errors are plain
// language; a 403 surfaces the server's message.
// ============================================================================

const TITLE_MAX = 500;
const DESCRIPTION_MAX = 20000;

const FIELD_STYLES =
  "mt-1 block w-full rounded-md border border-hairline bg-surface-1 px-4 py-2.5 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";
const LABEL_STYLES =
  "block text-xs font-medium uppercase tracking-wider text-ink-subtle";

type Tab = "details" | "comments" | "history" | "attachments";

interface CardModalProps {
  projectId: string;
  card: BoardCard;
  members: ProjectMember[];
  onClose: () => void;
  onSaved: (card: BoardCard) => void;
  onDeleted: (cardId: string) => void;
}

function initials(name: string | null, email: string | null): string {
  const src = (name && name.trim()) || (email && email.trim()) || "?";
  return src.charAt(0).toUpperCase();
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CardModal({
  projectId,
  card,
  members,
  onClose,
  onSaved,
  onDeleted,
}: CardModalProps) {
  const [tab, setTab] = useState<Tab>("details");
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [assigneeId, setAssigneeId] = useState(card.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Assignees come from the whole org, not just project members.
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [cardLabels, setCardLabels] = useState<CardLabel[]>(card.labels ?? []);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [attachments, setAttachments] = useState<CardAttachment[]>([]);

  const base = `/api/projects/${projectId}/cards/${card.id}`;

  const handleClose = useCallback(() => {
    if (!saving && !deleting) onClose();
  }, [saving, deleting, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // Load org members + card labels + counts on mount (promise callbacks keep
  // setState out of the synchronous effect body, per the repo's fetch pattern).
  useEffect(() => {
    fetch("/api/organisations/members", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.members) setOrgMembers(d.members);
      })
      .catch(() => {});
    fetch(`${base}/labels`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.labels) setCardLabels(d.labels);
      })
      .catch(() => {});
    fetch(`${base}/comments`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.comments) setComments(d.comments);
      })
      .catch(() => {});
    fetch(`${base}/attachments`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.attachments) setAttachments(d.attachments);
      })
      .catch(() => {});
  }, [base]);

  // Org members, with the project members as a fallback if the org call fails.
  const assignable: OrgMember[] =
    orgMembers.length > 0
      ? orgMembers
      : members.map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          email: m.email,
          role: m.role,
        }));

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError("A card needs a title.");
      return;
    }
    if (trimmed.length > TITLE_MAX) {
      setError(`Keep the title under ${TITLE_MAX} characters.`);
      return;
    }
    setSaving(true);
    try {
      // dueDate is validated against YYYY-MM-DD on the server, which rejects an
      // empty string — so only send it when set.
      const payload: Record<string, unknown> = {
        title: trimmed,
        description: description.trim(),
        priority,
        assigneeId: assigneeId || null,
      };
      if (dueDate.trim()) payload.dueDate = dueDate.trim();
      const res = await fetch(base, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not save the card. Please try again.");
        return;
      }
      onSaved({ ...(data.card as BoardCard), labels: cardLabels });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(base, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Could not delete the card. Please try again.");
        return;
      }
      onDeleted(card.id);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof MessageSquare; count?: number }[] =
    [
      { key: "details", label: "Details", icon: FileText },
      { key: "comments", label: "Comments", icon: MessageSquare, count: comments.length },
      { key: "history", label: "History", icon: Clock },
      {
        key: "attachments",
        label: "Files",
        icon: Paperclip,
        count: attachments.length,
      },
    ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      onMouseDown={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Card"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-hairline bg-canvas sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-hairline px-5 pt-4">
          <div className="min-w-0 flex-1 pb-3">
            <input
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && handleSave()}
              className="w-full bg-transparent text-lg font-semibold tracking-tight text-ink placeholder:text-ink-tertiary focus:outline-none"
              placeholder="Card title"
            />
            {cardLabels.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {cardLabels.map((l) => (
                  <LabelChip key={l.id} label={l} />
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-hairline px-3">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "border-primary text-ink"
                    : "border-transparent text-ink-subtle hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-subtle">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {tab === "details" && (
            <div className="space-y-5">
              <div>
                <label htmlFor="card-description" className={LABEL_STYLES}>
                  Description
                </label>
                <textarea
                  id="card-description"
                  rows={4}
                  value={description}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Notes, acceptance criteria, links. Optional."
                  onChange={(e) => setDescription(e.target.value)}
                  className={FIELD_STYLES}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="card-priority" className={LABEL_STYLES}>
                    Priority
                  </label>
                  <select
                    id="card-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className={FIELD_STYLES}
                  >
                    {CARD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="card-due" className={LABEL_STYLES}>
                    Due date
                  </label>
                  <DateField
                    id="card-due"
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="DD/MM/YYYY"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="card-assignee" className={LABEL_STYLES}>
                  Assignee
                </label>
                <select
                  id="card-assignee"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className={FIELD_STYLES}
                >
                  <option value="">Unassigned</option>
                  {assignable.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName || m.email}
                    </option>
                  ))}
                </select>
              </div>

              <LabelSection
                projectId={projectId}
                cardId={card.id}
                assigned={cardLabels}
                onChange={setCardLabels}
              />

              {error && (
                <div className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3">
                  <p className="text-sm text-semantic-error">{error}</p>
                </div>
              )}
            </div>
          )}

          {tab === "comments" && (
            <CommentsTab
              base={base}
              comments={comments}
              onChange={setComments}
            />
          )}

          {tab === "history" && <HistoryTab base={base} />}

          {tab === "attachments" && (
            <AttachmentsTab
              base={base}
              attachments={attachments}
              onChange={setAttachments}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-subtle">Delete this card?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-semantic-error/40 bg-semantic-error/10 px-3 py-1.5 text-sm font-medium text-semantic-error transition-colors hover:bg-semantic-error/20 disabled:opacity-60"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="min-h-11 rounded-md px-3 py-1.5 text-sm text-ink-subtle transition-colors hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-ink-tertiary transition-colors hover:text-semantic-error"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}

          {tab === "details" && (
            <button
              type="button"
              onClick={() => handleSave()}
              disabled={saving || deleting}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Label chip + the Details-tab label picker
// ----------------------------------------------------------------------------

function LabelChip({ label }: { label: CardLabel }) {
  const color = label.color || "var(--color-ink-subtle)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label.name}
    </span>
  );
}

function LabelSection({
  projectId,
  cardId,
  assigned,
  onChange,
}: {
  projectId: string;
  cardId: string;
  assigned: CardLabel[];
  onChange: (labels: CardLabel[]) => void;
}) {
  const [all, setAll] = useState<CardLabel[]>([]);
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/labels`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.labels) setAll(d.labels);
      })
      .catch(() => {});
  }, [projectId]);

  const assignedIds = new Set(assigned.map((l) => l.id));
  const available = all.filter((l) => !assignedIds.has(l.id));

  async function assign(label: CardLabel) {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cards/${cardId}/labels`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelId: label.id }),
      });
      if (res.ok) onChange([...assigned, label]);
    } finally {
      setBusy(false);
      setPicking(false);
    }
  }

  async function unassign(label: CardLabel) {
    onChange(assigned.filter((l) => l.id !== label.id));
    await fetch(
      `/api/projects/${projectId}/cards/${cardId}/labels/${label.id}`,
      { method: "DELETE", credentials: "same-origin" },
    ).catch(() => {});
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/labels`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.label) {
        setAll((prev) => [...prev, data.label]);
        await assign(data.label);
        setNewName("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className={LABEL_STYLES}>Labels</span>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {assigned.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => unassign(l)}
            className="group"
            title="Remove label"
          >
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: `color-mix(in srgb, ${l.color || "var(--color-ink-subtle)"} 16%, transparent)`,
                color: l.color || "var(--color-ink-subtle)",
              }}
            >
              {l.name}
              <X className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100" />
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-hairline px-2 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:border-hairline-strong hover:text-ink-subtle"
        >
          <Tag className="h-3 w-3" />
          Label
        </button>
      </div>

      {picking && (
        <div className="mt-2 rounded-md border border-hairline bg-surface-1 p-3">
          {available.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {available.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={busy}
                  onClick={() => assign(l)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${l.color || "var(--color-ink-subtle)"} 16%, transparent)`,
                    color: l.color || "var(--color-ink-subtle)",
                  }}
                >
                  <Plus className="h-2.5 w-2.5" />
                  {l.name}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  createAndAssign();
                }
              }}
              placeholder="New label…"
              maxLength={100}
              className="flex-1 rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={createAndAssign}
              disabled={busy || !newName.trim()}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Comments tab
// ----------------------------------------------------------------------------

function CommentsTab({
  base,
  comments,
  onChange,
}: {
  base: string;
  comments: CardComment[];
  onChange: (c: CardComment[]) => void;
}) {
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  async function post() {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    try {
      const res = await fetch(`${base}/comments`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.comment) {
        onChange([...comments, data.comment]);
        setBody("");
      }
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    onChange(comments.filter((c) => c.id !== id));
    await fetch(`${base}/comments/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-subtle">
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-ink-subtle">
                {initials(c.displayName, c.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {c.displayName || c.email || "Someone"}
                  </span>
                  <span className="text-[11px] text-ink-tertiary">
                    {timeAgo(c.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    aria-label="Delete comment"
                    className="ml-auto text-ink-tertiary transition-colors hover:text-semantic-error"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 border-t border-hairline pt-4">
        <textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              post();
            }
          }}
          placeholder="Write a comment… (⌘↵ to send)"
          className="flex-1 resize-none rounded-md border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={post}
          disabled={posting || !body.trim()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
          aria-label="Post comment"
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// History tab
// ----------------------------------------------------------------------------

function HistoryTab({ base }: { base: string }) {
  const [items, setItems] = useState<CardActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${base}/activity`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.activity ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [base]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-md border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-subtle">
        No history yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 text-sm">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-hairline-strong" />
          <div className="min-w-0">
            <span className="text-ink-muted">
              <span className="font-medium text-ink">
                {a.displayName || "Someone"}
              </span>{" "}
              {a.action}
            </span>
            <span className="ml-2 text-[11px] text-ink-tertiary">
              {timeAgo(a.createdAt)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------------------
// Attachments tab
// ----------------------------------------------------------------------------

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentsTab({
  base,
  attachments,
  onChange,
}: {
  base: string;
  attachments: CardAttachment[];
  onChange: (a: CardAttachment[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > 50 * 1024 * 1024) {
      setError("Files must be 50MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${base}/attachments`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 503) {
        setError(
          data?.error ??
            "File storage isn't configured. Add Cloudinary in admin settings.",
        );
        return;
      }
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Upload failed. Please try again.");
        return;
      }
      if (data.attachment) onChange([data.attachment, ...attachments]);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    onChange(attachments.filter((a) => a.id !== id));
    await fetch(`${base}/attachments/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-hairline px-4 py-6 text-sm text-ink-subtle transition-colors hover:border-hairline-strong hover:text-ink">
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        {uploading ? "Uploading…" : "Add a file (max 50MB)"}
        <input
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>

      {error && <p className="text-sm text-semantic-error">{error}</p>}

      {attachments.length === 0 ? (
        <p className="py-2 text-center text-sm text-ink-subtle">
          No files attached.
        </p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 rounded-md border border-hairline bg-surface-1 px-3 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-ink-tertiary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{a.fileName}</p>
                {a.fileSize && (
                  <p className="text-[11px] text-ink-tertiary">
                    {fmtSize(a.fileSize)}
                  </p>
                )}
              </div>
              <a
                href={a.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="Open file"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => remove(a.id)}
                aria-label="Remove file"
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-semantic-error"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
