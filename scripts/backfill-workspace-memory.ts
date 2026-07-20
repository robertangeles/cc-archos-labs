// Idempotent backfill of existing workspace entities (projects, clients, kanban
// cards) into the org-shared workspace_memory tier.
//
// A ROLLOUT step, run PER ORG after migration 0035 is applied to that database
// and BEFORE flipping WORKSPACE_MEMORY_INGEST on for the org — so existing data
// is remembered, not just writes made after the flag flips.
//
//   pnpm backfill:workspace-memory --org <orgId>
//   pnpm backfill:workspace-memory --all
//
// The pnpm alias runs with --conditions=react-server so the server-only-guarded
// lib chain (lib/db, lib/embeddings) resolves under tsx.
//
// Safe to re-run: ingestEntity supersedes the entity's prior fact and dedups on
// (organisation_id, md5(body)). Makes real embedding calls (one per entity),
// bounded by the ingest queue (p-limit 4).

import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { organisation, project, kanbanCard } from "../lib/db/schema";
import { listProjects, projectFact } from "../lib/projects/service";
import { listClients, clientFact } from "../lib/clients/service";
import { cardFact } from "../lib/kanban/service";
import { ingestEntity } from "../lib/brain/workspace-ingest";

async function backfillOrg(orgId: string) {
  const projects = await listProjects(orgId);
  const clients = await listClients(orgId);
  // No list-all-cards-for-org helper — join cards through their project's org.
  const cards = await getDb()
    .select({
      id: kanbanCard.id,
      title: kanbanCard.title,
      description: kanbanCard.description,
    })
    .from(kanbanCard)
    .innerJoin(project, eq(kanbanCard.projectId, project.id))
    .where(eq(project.organisationId, orgId));

  await Promise.all([
    ...projects.map((p) =>
      ingestEntity({
        orgId,
        sourceType: "project",
        sourceEntityId: p.id,
        body: projectFact(p),
      }),
    ),
    ...clients.map((c) =>
      ingestEntity({
        orgId,
        sourceType: "client",
        sourceEntityId: c.id,
        body: clientFact(c),
      }),
    ),
    ...cards.map((c) =>
      ingestEntity({
        orgId,
        sourceType: "kanban_card",
        sourceEntityId: c.id,
        body: cardFact(c),
      }),
    ),
  ]);

  return {
    projects: projects.length,
    clients: clients.length,
    cards: cards.length,
  };
}

async function main() {
  // Force ingest on for this run regardless of the live per-org flag.
  process.env.WORKSPACE_MEMORY_INGEST = "true";

  const args = process.argv.slice(2);
  let orgIds: string[];
  if (args.includes("--all")) {
    const rows = await getDb().select({ id: organisation.id }).from(organisation);
    orgIds = rows.map((r) => r.id);
  } else {
    const i = args.indexOf("--org");
    const orgId = i >= 0 ? args[i + 1] : undefined;
    if (!orgId) {
      console.error(
        "usage: backfill-workspace-memory --org <orgId> | --all",
      );
      process.exit(1);
    }
    orgIds = [orgId];
  }

  const totals = { projects: 0, clients: 0, cards: 0 };
  for (const orgId of orgIds) {
    const r = await backfillOrg(orgId);
    totals.projects += r.projects;
    totals.clients += r.clients;
    totals.cards += r.cards;
    console.log(
      `org ${orgId}: ${r.projects} projects, ${r.clients} clients, ${r.cards} cards`,
    );
  }
  console.log(
    `DONE: ${orgIds.length} org(s) — ${totals.projects} projects, ${totals.clients} clients, ${totals.cards} cards ingested`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
