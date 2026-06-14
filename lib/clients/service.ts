import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { client, clientContact, clientContract } from "../db/schema";
import type {
  CreateClientInput,
  UpdateClientInput,
  ContactInput,
  UpdateContactInput,
  ContractInput,
  UpdateContractInput,
} from "./validation";

// ============================================================================
// Clients service — pure data access for the consulting CRM.
// Access control (auth + role) happens in the route via lib/auth/org-context.
// This layer's ONE job is org-scoping: every read and write is filtered by the
// org so a client/contact/contract from another tenant can never be touched.
//
// IDOR model:
//   - client rows carry organisation_id → filter directly by (id, orgId).
//   - contact/contract rows carry only client_id → we verify the parent client
//     belongs to the org (clientBelongsToOrg / a join) BEFORE any read or write.
// All selects list explicit columns (CLAUDE.md: never select *).
// ============================================================================

/** Columns returned for a client. Listed explicitly — never select *. */
const clientColumns = {
  id: client.id,
  organisationId: client.organisationId,
  name: client.name,
  industry: client.industry,
  website: client.website,
  companySize: client.companySize,
  abnTaxId: client.abnTaxId,
  addressLine1: client.addressLine1,
  addressLine2: client.addressLine2,
  city: client.city,
  state: client.state,
  postalCode: client.postalCode,
  country: client.country,
  notes: client.notes,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
} as const;

const contactColumns = {
  id: clientContact.id,
  clientId: clientContact.clientId,
  name: clientContact.name,
  email: clientContact.email,
  phone: clientContact.phone,
  role: clientContact.role,
  isPrimary: clientContact.isPrimary,
  createdAt: clientContact.createdAt,
  updatedAt: clientContact.updatedAt,
} as const;

const contractColumns = {
  id: clientContract.id,
  clientId: clientContract.clientId,
  name: clientContract.name,
  contractType: clientContract.contractType,
  status: clientContract.status,
  startDate: clientContract.startDate,
  endDate: clientContract.endDate,
  billingRate: clientContract.billingRate,
  notes: clientContract.notes,
  createdAt: clientContract.createdAt,
  updatedAt: clientContract.updatedAt,
} as const;

/**
 * IDOR guard for child rows. Returns true only if `clientId` exists AND belongs
 * to `orgId`. Every contact/contract operation calls this first so a caller in
 * org B can never reach a client owned by org A via its clientId.
 */
async function clientBelongsToOrg(
  db: DB,
  orgId: string,
  clientId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: client.id })
    .from(client)
    .where(and(eq(client.id, clientId), eq(client.organisationId, orgId)))
    .limit(1);
  return rows.length > 0;
}

// ---- clients ---------------------------------------------------------------

/** All clients for an org, newest-updated first. */
export async function listClients(orgId: string, dbArg?: DB) {
  const db = dbArg ?? getDb();
  return db
    .select(clientColumns)
    .from(client)
    .where(eq(client.organisationId, orgId))
    .orderBy(desc(client.updatedAt));
}

/**
 * A single client scoped to the org. Filters by id AND organisationId — this is
 * the IDOR guard: a client id from another org resolves to null, not a row.
 */
export async function getClient(
  orgId: string,
  clientId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const rows = await db
    .select(clientColumns)
    .from(client)
    .where(and(eq(client.id, clientId), eq(client.organisationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createClient(
  orgId: string,
  input: CreateClientInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [created] = await db
    .insert(client)
    .values({
      organisationId: orgId,
      name: input.name,
      industry: input.industry ?? null,
      website: input.website ?? null,
      companySize: input.companySize ?? null,
      abnTaxId: input.abnTaxId ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      notes: input.notes ?? null,
    })
    .returning(clientColumns);
  return created;
}

/** Update a client scoped to the org. Returns the updated row or null. */
export async function updateClient(
  orgId: string,
  clientId: string,
  input: UpdateClientInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  const [updated] = await db
    .update(client)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.companySize !== undefined
        ? { companySize: input.companySize }
        : {}),
      ...(input.abnTaxId !== undefined ? { abnTaxId: input.abnTaxId } : {}),
      ...(input.addressLine1 !== undefined
        ? { addressLine1: input.addressLine1 }
        : {}),
      ...(input.addressLine2 !== undefined
        ? { addressLine2: input.addressLine2 }
        : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.postalCode !== undefined
        ? { postalCode: input.postalCode }
        : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(client.id, clientId), eq(client.organisationId, orgId)))
    .returning(clientColumns);
  return updated ?? null;
}

/** Delete a client scoped to the org. Returns true if a row was removed. */
export async function deleteClient(
  orgId: string,
  clientId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  const removed = await db
    .delete(client)
    .where(and(eq(client.id, clientId), eq(client.organisationId, orgId)))
    .returning({ id: client.id });
  return removed.length > 0;
}

// ---- contacts --------------------------------------------------------------

/**
 * Contacts for a client, but ONLY if the client belongs to the org. Joins on
 * the client's organisation_id so a clientId from another org returns []. Newest
 * contact first.
 */
export async function listContacts(
  orgId: string,
  clientId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  return db
    .select(contactColumns)
    .from(clientContact)
    .innerJoin(client, eq(clientContact.clientId, client.id))
    .where(
      and(
        eq(clientContact.clientId, clientId),
        eq(client.organisationId, orgId),
      ),
    )
    .orderBy(desc(clientContact.createdAt));
}

/**
 * Create a contact under a client. Verifies the parent client belongs to the
 * org first (IDOR guard). Returns null if the client isn't in this org.
 */
export async function createContact(
  orgId: string,
  clientId: string,
  input: ContactInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return null;
  const [created] = await db
    .insert(clientContact)
    .values({
      clientId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      role: input.role ?? null,
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
    })
    .returning(contactColumns);
  return created;
}

/**
 * Update a contact. Org-scoped through the parent client: the update only
 * matches when a subquery confirms the contact's client is in this org.
 * Returns the updated row or null.
 */
export async function updateContact(
  orgId: string,
  clientId: string,
  contactId: string,
  input: UpdateContactInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return null;
  const [updated] = await db
    .update(clientContact)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(clientContact.id, contactId),
        eq(clientContact.clientId, clientId),
      ),
    )
    .returning(contactColumns);
  return updated ?? null;
}

/** Delete a contact, org-scoped through the parent client. Returns boolean. */
export async function deleteContact(
  orgId: string,
  clientId: string,
  contactId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return false;
  const removed = await db
    .delete(clientContact)
    .where(
      and(
        eq(clientContact.id, contactId),
        eq(clientContact.clientId, clientId),
      ),
    )
    .returning({ id: clientContact.id });
  return removed.length > 0;
}

// ---- contracts -------------------------------------------------------------

/** Contracts for a client, only if the client belongs to the org. */
export async function listContracts(
  orgId: string,
  clientId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  return db
    .select(contractColumns)
    .from(clientContract)
    .innerJoin(client, eq(clientContract.clientId, client.id))
    .where(
      and(
        eq(clientContract.clientId, clientId),
        eq(client.organisationId, orgId),
      ),
    )
    .orderBy(desc(clientContract.createdAt));
}

/** Create a contract under a client, IDOR-guarded. Returns null if not in org. */
export async function createContract(
  orgId: string,
  clientId: string,
  input: ContractInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return null;
  const [created] = await db
    .insert(clientContract)
    .values({
      clientId,
      name: input.name,
      contractType: input.contractType ?? null,
      ...(input.status !== undefined ? { status: input.status } : {}),
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      billingRate: input.billingRate ?? null,
      notes: input.notes ?? null,
    })
    .returning(contractColumns);
  return created;
}

/** Update a contract, org-scoped through the parent client. */
export async function updateContract(
  orgId: string,
  clientId: string,
  contractId: string,
  input: UpdateContractInput,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return null;
  const [updated] = await db
    .update(clientContract)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.contractType !== undefined
        ? { contractType: input.contractType }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.billingRate !== undefined
        ? { billingRate: input.billingRate }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(clientContract.id, contractId),
        eq(clientContract.clientId, clientId),
      ),
    )
    .returning(contractColumns);
  return updated ?? null;
}

/** Delete a contract, org-scoped through the parent client. Returns boolean. */
export async function deleteContract(
  orgId: string,
  clientId: string,
  contractId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();
  if (!(await clientBelongsToOrg(db, orgId, clientId))) return false;
  const removed = await db
    .delete(clientContract)
    .where(
      and(
        eq(clientContract.id, contractId),
        eq(clientContract.clientId, clientId),
      ),
    )
    .returning({ id: clientContract.id });
  return removed.length > 0;
}
