import Link from "next/link";
import { listUsers } from "../../../../lib/auth/users";
import { UserRowActions } from "./user-row-actions";

export const dynamic = "force-dynamic";

// /admin/users — list of all accounts in the system. Admin can:
//   - Filter by role (all / admin / member)
//   - Filter by status (all / active / inactive)
//   - Search by email or display name
//   - Promote/demote between admin and member
//   - Deactivate/reactivate an account
//   - Drill into a single user for audit log + sessions
//
// Gated by proxy.ts (admin session required).

interface PageProps {
  searchParams: Promise<{
    page?: string;
    role?: "all" | "admin" | "member";
    active?: "all" | "active" | "inactive";
    search?: string;
  }>;
}

export default async function UsersAdminPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const roleFilter = sp.role ?? "all";
  const activeFilter = sp.active ?? "all";
  const search = sp.search ?? "";

  const result = await listUsers({
    page,
    pageSize: 25,
    roleFilter,
    activeFilter,
    search,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Users & Roles</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          Every account in the system. Admins have full backstage access;
          members are public account holders (created via the diagnostic
          flow or future sign-up). Role and status changes revoke all
          active sessions for the affected user.
        </p>
      </header>

      <FilterBar
        currentRole={roleFilter}
        currentActive={activeFilter}
        currentSearch={search}
      />

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-surface-1/50">
            <tr className="text-left">
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Verified</Th>
              <Th>Sign-in</Th>
              <Th>Last login</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-subtle">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              result.rows.map((u) => (
                <tr key={u.id} className="hover:bg-surface-1/30">
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="block hover:underline"
                    >
                      <div className="font-medium text-ink">
                        {u.displayName || "—"}
                      </div>
                      <div className="text-xs text-ink-subtle">{u.email}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <RolePill role={u.role} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusPill active={u.isActive} />
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-subtle">
                    {u.emailVerifiedAt ? "✓" : "—"}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-subtle">
                    <SignInMethods
                      hasPassword={u.hasPasswordHash}
                      providers={u.linkedProviders}
                    />
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-subtle">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toISOString().slice(0, 10)
                      : "never"}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <UserRowActions
                      userId={u.id}
                      currentRole={u.role}
                      currentActive={u.isActive}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={result.page}
        totalPages={totalPages}
        total={result.total}
        roleFilter={roleFilter}
        activeFilter={activeFilter}
        search={search}
      />
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle ${className}`}
    >
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

function SignInMethods({
  hasPassword,
  providers,
}: {
  hasPassword: boolean;
  providers: string[];
}) {
  const items: string[] = [];
  if (hasPassword) items.push("password");
  for (const p of providers) items.push(p);
  if (items.length === 0) return <span>—</span>;
  return <span>{items.join(", ")}</span>;
}

function FilterBar({
  currentRole,
  currentActive,
  currentSearch,
}: {
  currentRole: string;
  currentActive: string;
  currentSearch: string;
}) {
  return (
    <form
      method="get"
      action="/admin/users"
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
    >
      <FilterSelect
        name="role"
        label="Role"
        value={currentRole}
        options={[
          { value: "all", label: "All roles" },
          { value: "admin", label: "Admin" },
          { value: "member", label: "Member" },
        ]}
      />
      <FilterSelect
        name="active"
        label="Status"
        value={currentActive}
        options={[
          { value: "all", label: "All statuses" },
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
      />
      <label className="flex flex-col gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
          Search
        </span>
        <input
          type="search"
          name="search"
          defaultValue={currentSearch}
          placeholder="email or name"
          className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
        />
      </label>
      <button
        type="submit"
        className="rounded-md bg-ink px-4 py-1.5 text-sm text-canvas hover:bg-ink/90"
      >
        Apply
      </button>
    </form>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-y-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
        {label}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  roleFilter,
  activeFilter,
  search,
}: {
  page: number;
  totalPages: number;
  total: number;
  roleFilter: string;
  activeFilter: string;
  search: string;
}) {
  const baseParams = new URLSearchParams();
  if (roleFilter !== "all") baseParams.set("role", roleFilter);
  if (activeFilter !== "all") baseParams.set("active", activeFilter);
  if (search) baseParams.set("search", search);

  const prevHref = `/admin/users?${new URLSearchParams({ ...Object.fromEntries(baseParams), page: String(Math.max(1, page - 1)) }).toString()}`;
  const nextHref = `/admin/users?${new URLSearchParams({ ...Object.fromEntries(baseParams), page: String(Math.min(totalPages, page + 1)) }).toString()}`;

  return (
    <div className="flex items-center justify-between text-xs text-ink-subtle">
      <span>
        {total} {total === 1 ? "user" : "users"} · page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-x-3">
        {page > 1 ? (
          <Link href={prevHref} className="hover:text-ink">
            ← Prev
          </Link>
        ) : (
          <span className="opacity-30">← Prev</span>
        )}
        {page < totalPages ? (
          <Link href={nextHref} className="hover:text-ink">
            Next →
          </Link>
        ) : (
          <span className="opacity-30">Next →</span>
        )}
      </div>
    </div>
  );
}
