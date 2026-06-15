"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Check,
  Copy,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";

type OrgRole = "owner" | "admin" | "member";

interface OrgListEntry {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

interface Member {
  id: string;
  userId: string;
  role: OrgRole;
  displayName: string | null;
  email: string;
  joinedAt: string;
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  joinKey?: string;
  ownerId: string;
  members: Member[];
}

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

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

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function memberInitial(m: Member): string {
  const source = (m.displayName || m.email || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

export function OrgManagement() {
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the current org (first in the user's list) plus its detail + members.
  // The active org is not exposed by the API; the list is ordered newest-first,
  // matching the server's default-org resolution, so the first entry is current.
  const load = useCallback<() => Promise<void>>(() => {
    const fallback = "We couldn't load your organisation. Try again.";
    // Promise-chain form (not async/await): every setState lands inside a .then
    // / .catch / .finally callback, never synchronously — which is what the
    // workspace's other list components do and what keeps refreshes cheap.
    return fetch("/api/organisations")
      .then((r) => r.json())
      .then((listData) => {
        if (!listData?.ok) {
          throw new Error(listData?.error ?? fallback);
        }
        const orgs: OrgListEntry[] = listData.organisations ?? [];
        const current = orgs[0];
        if (!current) {
          setLoadError(null);
          setOrg(null);
          setMyRole(null);
          return;
        }
        setMyRole(current.role);
        return fetch(`/api/organisations/${current.id}`)
          .then((r) => r.json())
          .then((detailData) => {
            if (!detailData?.ok) {
              throw new Error(detailData?.error ?? fallback);
            }
            setLoadError(null);
            setOrg(detailData.organisation as OrgDetail);
          });
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : fallback);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-lg border border-hairline bg-surface-1"
          />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <Building2 className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h3 className="mt-4 text-sm font-medium text-ink">
          Something went wrong
        </h3>
        <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  if (!org || !myRole) {
    return (
      <div className="rounded-lg border border-dashed border-hairline bg-surface-1 px-6 py-12 text-center">
        <Building2 className="mx-auto h-8 w-8 text-ink-tertiary" />
        <h3 className="mt-4 text-sm font-medium text-ink">No organisation yet</h3>
        <p className="mx-auto mt-2 max-w-xs text-xs text-ink-subtle">
          You are not part of an organisation. One is created for you when you
          sign up.
        </p>
      </div>
    );
  }

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const ownerCount = org.members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-3">
      <motion.section
        custom={0}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
      >
        <OrgDetailsCard org={org} canEdit={canManage} onSaved={load} />
      </motion.section>

      {canManage ? (
        <motion.section
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <InviteCard org={org} onRegenerated={load} />
        </motion.section>
      ) : null}

      <motion.section
        custom={canManage ? 2 : 1}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
      >
        <MembersCard
          org={org}
          myRole={myRole}
          ownerCount={ownerCount}
          onChanged={load}
        />
      </motion.section>

      {isOwner ? (
        <motion.section
          custom={3}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <DangerZoneCard org={org} />
        </motion.section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Org details — name + description, inline-editable by owner/admin.
// ---------------------------------------------------------------------------
function OrgDetailsCard({
  org,
  canEdit,
  onSaved,
}: {
  org: OrgDetail;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setName(org.name);
    setDescription(org.description ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (name.trim().length === 0) {
      setError("Give your organisation a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "We couldn't save those changes. Try again.");
        return;
      }
      setEditing(false);
      await onSaved();
    } catch {
      setError("We couldn't save those changes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-lg border border-hairline bg-surface-1 p-6"
      style={{ borderLeftWidth: "3px", borderLeftColor: "var(--color-primary)" }}
    >
      {!editing ? (
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-subtle">
              <Building2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">
                {org.name}
              </h2>
              <p className="mt-1 text-sm text-ink-subtle">
                {org.description?.trim()
                  ? org.description
                  : "No description yet."}
              </p>
            </div>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md border border-hairline px-3 py-2 text-sm text-ink-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="org-name"
              className="block text-xs font-medium text-ink-subtle"
            >
              Organisation name
            </label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              maxLength={255}
              className="mt-1.5 w-full rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-primary-focus disabled:opacity-60"
            />
          </div>
          <div>
            <label
              htmlFor="org-description"
              className="block text-xs font-medium text-ink-subtle"
            >
              Description
            </label>
            <textarea
              id="org-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              rows={3}
              placeholder="What does this organisation do?"
              className="mt-1.5 w-full resize-y rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-primary-focus disabled:opacity-60"
            />
          </div>
          {error ? <p className="text-xs text-semantic-error">{error}</p> : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-hairline px-4 py-2 text-sm text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite — shows the join key with copy + regenerate. Owner/admin only.
// ---------------------------------------------------------------------------
function InviteCard({
  org,
  onRegenerated,
}: {
  org: OrgDetail;
  onRegenerated: () => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinKey = org.joinKey ?? "";

  async function copy() {
    if (!joinKey) return;
    try {
      await navigator.clipboard.writeText(joinKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("We couldn't copy the key. Copy it manually.");
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${org.id}/regenerate-key`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "We couldn't regenerate the key. Try again.");
        return;
      }
      setConfirming(false);
      await onRegenerated();
    } catch {
      setError("We couldn't regenerate the key. Try again.");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-subtle">
          <KeyRound className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Invite key</h2>
          <p className="mt-1 text-sm text-ink-subtle">
            Share this key so people can join. Regenerate it to revoke access for
            anyone who has the old one.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 truncate rounded-md border border-hairline bg-surface-2 px-3 py-2.5 font-mono text-sm text-ink-muted">
          {joinKey || "—"}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!joinKey}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-hairline px-4 py-2 text-sm text-ink-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-ink disabled:opacity-60"
        >
          {copied ? (
            <Check className="h-4 w-4 text-semantic-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        {!confirming ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1 text-sm text-ink-subtle transition-colors hover:text-ink"
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate key
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-subtle">
              Anyone using the current key will no longer be able to join. This
              cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={regenerate}
                disabled={regenerating}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={regenerating}
                className="inline-flex min-h-[44px] items-center rounded-md border border-hairline px-4 py-2 text-sm text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error ? (
          <p className="mt-2 text-xs text-semantic-error">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members — list with role dropdowns + remove. Owner/admin manage.
// ---------------------------------------------------------------------------
function MembersCard({
  org,
  myRole,
  ownerCount,
  onChanged,
}: {
  org: OrgDetail;
  myRole: OrgRole;
  ownerCount: number;
  onChanged: () => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";

  async function changeRole(member: Member, role: OrgRole) {
    if (role === member.role) return;
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/organisations/${org.id}/members/${member.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "We couldn't update that member. Try again.");
        return;
      }
      await onChanged();
    } catch {
      setError("We couldn't update that member. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(member: Member) {
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/organisations/${org.id}/members/${member.id}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "We couldn't remove that member. Try again.");
        return;
      }
      await onChanged();
    } catch {
      setError("We couldn't remove that member. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-1 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-subtle">
          <Users className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Members</h2>
          <p className="mt-1 text-sm text-ink-subtle">
            {org.members.length} member{org.members.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs text-semantic-error">{error}</p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {org.members.map((m) => {
          const isLastOwner = m.role === "owner" && ownerCount <= 1;
          // Admins can never touch an owner row, set the owner role, or remove
          // owners — that is owner-only. The last owner can never be changed.
          const lockedForAdmin = !isOwner && m.role === "owner";
          const disableRow =
            !canManage || busyId === m.id || isLastOwner || lockedForAdmin;

          // The role options available to the current actor.
          const roleOptions: OrgRole[] = isOwner
            ? ["owner", "admin", "member"]
            : ["admin", "member"];

          return (
            <li
              key={m.id}
              className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-ink-subtle">
                  {memberInitial(m)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {m.displayName?.trim() || m.email}
                  </p>
                  <p className="truncate text-xs text-ink-subtle">{m.email}</p>
                  <p className="mt-0.5 text-[11px] text-ink-tertiary">
                    Joined {formatDate(m.joinedAt)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canManage ? (
                  <select
                    value={m.role}
                    disabled={disableRow}
                    onChange={(e) => changeRole(m, e.target.value as OrgRole)}
                    aria-label={`Role for ${m.displayName?.trim() || m.email}`}
                    className="min-h-[44px] rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-primary-focus disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {/* Keep the current role visible even when it is not an
                        option the actor could set (e.g. an admin viewing an
                        owner) so the row reads correctly. */}
                    {!roleOptions.includes(m.role) ? (
                      <option value={m.role}>{ROLE_LABELS[m.role]}</option>
                    ) : null}
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-subtle">
                    {ROLE_LABELS[m.role]}
                  </span>
                )}

                {canManage ? (
                  <button
                    type="button"
                    onClick={() => removeMember(m)}
                    disabled={disableRow}
                    aria-label={`Remove ${m.displayName?.trim() || m.email}`}
                    title={
                      isLastOwner
                        ? "An organisation must keep at least one owner"
                        : "Remove member"
                    }
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-hairline text-ink-subtle transition-colors hover:border-hairline-strong hover:bg-surface-2 hover:text-semantic-error disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danger zone — delete the organisation. Owner only, with type-to-confirm.
// ---------------------------------------------------------------------------
function DangerZoneCard({ org }: { org: OrgDetail }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteOrg() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/organisations/${org.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(
          data?.error ?? "We couldn't delete the organisation. Try again.",
        );
        setDeleting(false);
        return;
      }
      // The active org is gone; a full reload lets the server resolve the
      // user's next default org and rebuild the workspace cleanly.
      window.location.assign("/account");
    } catch {
      setError("We couldn't delete the organisation. Try again.");
      setDeleting(false);
    }
  }

  const confirmReady = confirmText.trim() === org.name.trim();

  return (
    <div
      className="rounded-lg border border-hairline bg-surface-1 p-6"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: "var(--color-semantic-error)",
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-semantic-error">
          <Trash2 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">Danger zone</h2>
          <p className="mt-1 text-sm text-ink-subtle">
            Deleting this organisation removes its members, clients, and
            projects. This cannot be undone.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {!confirming ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmText("");
              setConfirming(true);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-semantic-error/40 px-4 py-2 text-sm font-medium text-semantic-error transition-colors hover:bg-semantic-error/10"
          >
            <Trash2 className="h-4 w-4" />
            Delete organisation
          </button>
        ) : (
          <div className="space-y-3">
            <label
              htmlFor="org-delete-confirm"
              className="block text-sm text-ink-subtle"
            >
              Type{" "}
              <span className="font-medium text-ink">{org.name}</span> to
              confirm.
            </label>
            <input
              id="org-delete-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={deleting}
              autoComplete="off"
              className="w-full rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-primary-focus disabled:opacity-60"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={deleteOrg}
                disabled={deleting || !confirmReady}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-semantic-error px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  setError(null);
                }}
                disabled={deleting}
                className="inline-flex min-h-[44px] items-center rounded-md border border-hairline px-4 py-2 text-sm text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error ? (
          <p className="mt-2 text-xs text-semantic-error">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
