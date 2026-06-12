import "server-only";
import { eq, desc, or, ilike, sql, and } from "drizzle-orm";
import { getDb } from "./db";
import { bookingRequest } from "./db/schema";

export interface ListBookingsParams {
  page: number;
  pageSize?: number;
  status?: string;
  search?: string;
}

export interface BookingRow {
  id: string;
  name: string;
  email: string;
  organisation: string | null;
  slotStart: Date;
  slotEnd: Date;
  status: string;
  meetUrl: string | null;
  createdAt: Date;
}

export interface ListBookingsResult {
  rows: BookingRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listBookings(
  params: ListBookingsParams,
): Promise<ListBookingsResult> {
  const db = getDb();
  const pageSize = params.pageSize ?? 25;
  const offset = (params.page - 1) * pageSize;

  const conditions = [];

  if (params.status && params.status !== "all") {
    conditions.push(eq(bookingRequest.status, params.status));
  }

  if (params.search) {
    const like = `%${params.search}%`;
    conditions.push(
      or(
        ilike(bookingRequest.name, like),
        ilike(bookingRequest.email, like),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: bookingRequest.id,
        name: bookingRequest.name,
        email: bookingRequest.email,
        organisation: bookingRequest.organisation,
        slotStart: bookingRequest.slotStart,
        slotEnd: bookingRequest.slotEnd,
        status: bookingRequest.status,
        meetUrl: bookingRequest.meetUrl,
        createdAt: bookingRequest.createdAt,
      })
      .from(bookingRequest)
      .where(where)
      .orderBy(desc(bookingRequest.slotStart))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingRequest)
      .where(where),
  ]);

  return {
    rows: rows as BookingRow[],
    total: countResult[0]?.count ?? 0,
    page: params.page,
    pageSize,
  };
}
