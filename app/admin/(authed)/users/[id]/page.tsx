import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserDetail } from "../../../../../lib/auth/users";
import { UserRowActions } from "../user-row-actions";

export const dynamic = "force-dynamic";

// /admin/users/[id] — drill-in for a single user. Shows:
//   - Header with name + email + role/status + sign-in methods
//   - Action buttons (promote/demote, deactivate/reactivate)
//   - Active sessions (revocable in future, listed for now)
//   - Recent auth events (last 50)
//
// Gated by proxy.ts.

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-8">
      <Link
        href="/admin/users"
        className="inline-flex items-center text-xs text-ink-subtle hover:text-ink"
      >
        ← All users
      </Link>

      <header className="space-y-3">
        <h1 className="text-headline text-ink">
          {detail.displayName || detail.email}
        </h1>
        <div className="text-body-sm text-ink-subtle">{detail.email}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <RolePill role={detail.role} />
          <StatusPill active={detail.isActive} />
          {detail.emailVerifiedAt ? (
            <span className="text-ink-subtle">Email verified</span>
          ) : (
            <span className="text-amber-700">Email not verified</span>
          )}
          <span className="text-ink-subtle">
            Sign-in:{" "}
            {[
              detail.hasPasswordHash ? "password" : null,
              ...detail.linkedProviders,
            ]
              .filter(Boolean)
              .join(", ") || "none"}
          </span>
        </div>
        <div>
          <UserRowActions
            userId={detail.id}
            currentRole={detail.role}
            currentActive={detail.isActive}
          />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">Active sessions</h2>
        {detail.activeSessions.length === 0 ? (
          <p className="text-sm text-ink-subtle">No active sessions.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-surface-1/50">
                <tr className="text-left">
                  <Th>Last seen</Th>
                  <Th>Started</Th>
                  <Th>IP</Th>
                  <Th>User-Agent</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {detail.activeSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-xs text-ink-subtle">
                      {s.lastSeenAt
                        ? new Date(s.lastSeenAt).toISOString().slice(0, 16)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-subtle">
                      {new Date(s.createdAt).toISOString().slice(0, 16)}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-subtle">
                      {s.ipAddress ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-subtle">
                      <span className="line-clamp-1 max-w-[400px]">
                        {s.userAgent ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">Recent auth events</h2>
        {detail.recentEvents.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            No events recorded for this user.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-surface-1/50">
                <tr className="text-left">
                  <Th>When</Th>
                  <Th>Event</Th>
                  <Th>IP</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {detail.recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 align-top text-xs text-ink-subtle">
                      {new Date(e.createdAt).toISOString().slice(0, 16)}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-ink">
                      {e.eventType}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-ink-subtle">
                      {e.ipAddress ?? "—"}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-ink-subtle">
                      <code className="line-clamp-1 max-w-[400px] break-all">
                        {Object.keys(e.metadata).length === 0
                          ? "—"
                          : JSON.stringify(e.metadata)}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
      {children}
    </th>
  );
}

function RolePill({ role }: { role: string }) {
  const cls =
    role === "admin"
      ? "bg-indigo-100 text-indigo-900"
      : "bg-surface-2 text-ink-subtle";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {role}
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
      active
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
      inactive
    </span>
  );
}
