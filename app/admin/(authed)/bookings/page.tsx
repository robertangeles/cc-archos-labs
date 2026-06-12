import Link from "next/link";
import { listBookings } from "../../../../lib/bookings-admin";
import { BookingRowActions } from "./booking-row-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    status?: string;
    search?: string;
  }>;
}

export default async function BookingsAdminPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const statusFilter = sp.status ?? "all";
  const search = sp.search ?? "";

  const result = await listBookings({
    page,
    status: statusFilter,
    search,
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-headline text-ink">Bookings</h1>
        <p className="mt-2 max-w-2xl text-body-sm text-ink-subtle">
          All booking requests. Mark calls as completed or no-show to
          trigger the appropriate follow-up emails. The no-show recovery
          email only fires once a booking is marked as no-show here.
        </p>
      </header>

      <FilterBar currentStatus={statusFilter} currentSearch={search} />

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-surface-1/50">
            <tr className="text-left">
              <Th>Prospect</Th>
              <Th>Slot</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {result.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-ink-subtle"
                >
                  No bookings match these filters.
                </td>
              </tr>
            ) : (
              result.rows.map((b) => (
                <tr key={b.id} className="hover:bg-surface-1/30">
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-ink">{b.name}</div>
                    <div className="text-xs text-ink-subtle">{b.email}</div>
                    {b.organisation && (
                      <div className="text-xs text-ink-subtle/70">
                        {b.organisation}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-subtle">
                    <div>{formatDate(b.slotStart)}</div>
                    <div className="text-ink-subtle/70">
                      {formatTime(b.slotStart)} – {formatTime(b.slotEnd)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-ink-subtle">
                    {formatDate(b.createdAt)}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <BookingRowActions
                      bookingId={b.id}
                      currentStatus={b.status}
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
        statusFilter={statusFilter}
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

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-blue-100 text-blue-900",
  completed: "bg-emerald-100 text-emerald-900",
  no_show: "bg-red-100 text-red-900",
  cancelled: "bg-zinc-100 text-zinc-700",
  rescheduled_from: "bg-amber-100 text-amber-900",
  pending_calendar_sync: "bg-yellow-100 text-yellow-900",
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-surface-2 text-ink-subtle";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function FilterBar({
  currentStatus,
  currentSearch,
}: {
  currentStatus: string;
  currentSearch: string;
}) {
  return (
    <form
      method="get"
      action="/admin/bookings"
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
    >
      <label className="flex flex-col gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
          Status
        </span>
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-sm text-ink focus:border-ink-subtle focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="no_show">No show</option>
          <option value="cancelled">Cancelled</option>
          <option value="rescheduled_from">Rescheduled</option>
        </select>
      </label>
      <label className="flex flex-col gap-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
          Search
        </span>
        <input
          type="search"
          name="search"
          defaultValue={currentSearch}
          placeholder="name or email"
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

function Pagination({
  page,
  totalPages,
  total,
  statusFilter,
  search,
}: {
  page: number;
  totalPages: number;
  total: number;
  statusFilter: string;
  search: string;
}) {
  const baseParams = new URLSearchParams();
  if (statusFilter !== "all") baseParams.set("status", statusFilter);
  if (search) baseParams.set("search", search);

  const prevHref = `/admin/bookings?${new URLSearchParams({ ...Object.fromEntries(baseParams), page: String(Math.max(1, page - 1)) }).toString()}`;
  const nextHref = `/admin/bookings?${new URLSearchParams({ ...Object.fromEntries(baseParams), page: String(Math.min(totalPages, page + 1)) }).toString()}`;

  return (
    <div className="flex items-center justify-between text-xs text-ink-subtle">
      <span>
        {total} {total === 1 ? "booking" : "bookings"} · page {page} of{" "}
        {totalPages}
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
