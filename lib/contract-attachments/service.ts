import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, type DB } from "../db";
import { client, clientContract, clientContractAttachment } from "../db/schema";

// ============================================================================
// Contract attachments service — files attached to a client contract.
//
// Mirrors lib/kanban-attachments: access control is org-scoped through the
// contract's parent client, so an attachment is only ever reachable when its
// contract's client's organisation_id matches the caller's org.
// contractInOrg is the IDOR guard — a contract id is never trusted without the
// org join.
//
// Each function takes an optional `dbArg` so tests can pass the pglite harness
// db; production calls fall through to the lazy singleton getDb().
// ============================================================================

/**
 * Resolve whether a contract belongs to the caller's org (via its client).
 * Returns true only when the contract exists and its client's organisation_id
 * matches. The IDOR guard for every attachment op addressed by contractId.
 */
async function contractInOrg(
  db: DB,
  orgId: string,
  contractId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: clientContract.id })
    .from(clientContract)
    .innerJoin(client, eq(clientContract.clientId, client.id))
    .where(
      and(eq(clientContract.id, contractId), eq(client.organisationId, orgId)),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * List a contract's attachments, oldest-first. Empty if the contract is not in
 * the caller's org.
 */
export async function listAttachments(
  orgId: string,
  contractId: string,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await contractInOrg(db, orgId, contractId))) return [];

  return db
    .select({
      id: clientContractAttachment.id,
      contractId: clientContractAttachment.contractId,
      fileName: clientContractAttachment.fileName,
      fileUrl: clientContractAttachment.fileUrl,
      fileType: clientContractAttachment.fileType,
      fileSize: clientContractAttachment.fileSize,
      uploadedBy: clientContractAttachment.uploadedBy,
      createdAt: clientContractAttachment.createdAt,
    })
    .from(clientContractAttachment)
    .where(eq(clientContractAttachment.contractId, contractId))
    .orderBy(asc(clientContractAttachment.createdAt));
}

/**
 * Create an attachment row for a contract. Verifies the contract is in the org
 * first. Returns null if it is not. The file itself is uploaded to Cloudinary by
 * the route before this is called; this records the resulting metadata.
 */
export async function createAttachment(
  orgId: string,
  contractId: string,
  meta: {
    fileName: string;
    fileUrl: string;
    fileType: string | null;
    fileSize: number | null;
  },
  uploadedBy: string | null,
  dbArg?: DB,
) {
  const db = dbArg ?? getDb();
  if (!(await contractInOrg(db, orgId, contractId))) return null;

  const [inserted] = await db
    .insert(clientContractAttachment)
    .values({
      contractId,
      fileName: meta.fileName,
      fileUrl: meta.fileUrl,
      fileType: meta.fileType,
      fileSize: meta.fileSize,
      uploadedBy,
    })
    .returning({
      id: clientContractAttachment.id,
      contractId: clientContractAttachment.contractId,
      fileName: clientContractAttachment.fileName,
      fileUrl: clientContractAttachment.fileUrl,
      fileType: clientContractAttachment.fileType,
      fileSize: clientContractAttachment.fileSize,
      uploadedBy: clientContractAttachment.uploadedBy,
      createdAt: clientContractAttachment.createdAt,
    });

  return inserted;
}

/**
 * Delete an attachment. Removes it only when its contract is in the caller's
 * org. Returns true if a row was removed, false on any violation (not found,
 * wrong org). The org check happens via a join BEFORE the delete so an
 * attachment in another org can never be removed.
 */
export async function deleteAttachment(
  orgId: string,
  attachmentId: string,
  dbArg?: DB,
): Promise<boolean> {
  const db = dbArg ?? getDb();

  const [row] = await db
    .select({ id: clientContractAttachment.id })
    .from(clientContractAttachment)
    .innerJoin(
      clientContract,
      eq(clientContractAttachment.contractId, clientContract.id),
    )
    .innerJoin(client, eq(clientContract.clientId, client.id))
    .where(
      and(
        eq(clientContractAttachment.id, attachmentId),
        eq(client.organisationId, orgId),
      ),
    )
    .limit(1);
  if (!row) return false;

  const removed = await db
    .delete(clientContractAttachment)
    .where(eq(clientContractAttachment.id, attachmentId))
    .returning({ id: clientContractAttachment.id });
  return removed.length > 0;
}
