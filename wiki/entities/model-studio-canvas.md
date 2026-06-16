---
title: Model Studio Canvas
category: entity
created: 2026-06-17
updated: 2026-06-17
related: [[deployment-architecture]], [[2026-06-16-migration-generated-not-applied]]
---

The visual data-modelling surface of Model Studio: a React Flow canvas where entities are nodes, relationships are edges, and attributes live inside each entity box — migrated from the Spresso repo in gnhf steps 12–29.

## What it is

`/workspace/model-studio/[id]` renders a per-layer canvas (conceptual / logical / physical) for one `data_model`. Users add entities, give them attributes (with PK/FK/unique/nullable flags, a governance classification, and alt-key groups), and connect them with relationships carrying cardinality and verb phrases. Node positions and viewport persist per user, per layer.

## Data model (migration 0028)

Four tables, all scoped to a model via `data_model_id`, which is itself scoped to an org through `project.organisation_id`:

- **data_model_entity** — name, business_name, entity_type, layer, monotonic `display_id` (E001…), alt_key_labels, tags, `version`.
- **data_model_attribute** — name, data_type(+params), ordinal_position, the four boolean key flags, governance `classification` (nullable: PII/PCI/PHI/Financial/Confidential/Restricted/Internal/Public — NOT a structural enum; structure lives in the flags), alt_key_group, `version`.
- **data_model_relationship** — source/target entity, cardinalities, name + name_inverse, is_identifying, is_nullable_foreign_key, waypoints, `version`. Both endpoints must belong to the same model (enforced in the service; cross-model → 400).
- **data_model_canvas_state** — per (model, user, layer) node_positions + viewport + notation. Unique on those three. No version (last-write-wins; ephemeral view state).

## Optimistic locking contract

Every authored row carries an integer `version`. Updates run `UPDATE … SET …, version = version + 1 WHERE id = $id AND version = $expected`. Zero rows → re-read to tell "deleted" (→ 404/null) from "stale" (→ `VersionConflictError(serverVersion)`). Routes map the conflict to `409 { ok:false, code:'VERSION_CONFLICT', serverVersion }`; the client hooks surface a `conflict` state and the canvas shows a Refresh prompt. Canvas-state is the deliberate exception (last-write-wins).

## API surface (under `/api/model-studio/[id]`)

- `entities` (GET/POST) and `entities/[entityId]` (GET/PATCH/DELETE)
- `entities/[entityId]/attributes` (GET/POST) and `…/[attributeId]` (PATCH/DELETE — PATCH discriminates `{action:'reorder'}` vs field update)
- `attributes` (GET — batch load every attribute in the model, the canvas preload)
- `relationships` (GET/POST) and `relationships/[relationshipId]` (PATCH/DELETE)
- `canvas-state` (GET `?layer=` / PUT — per-user; any member, no owner|admin gate)

Reads are open to any org member; entity/attribute/relationship mutations are gated to owner|admin. `createdBy`/`userId` always come from the session, never the body.

## Layers

`data_model_entity` and `data_model_attribute` carry a `layer`; relationships do not (a relationship's layer is implied by its endpoints). The canvas loads one layer's entities and draws only the edges whose both endpoints are visible. Each layer keeps its own canvas-state row, so switching layers reloads positions.

## Conventions & migration notes

- Services are pure data access (`dbArg?: DB` injection, org IDOR guard via `modelInOrg`), mirroring `lib/model-studio/service.ts`. Errors: `ModelConflictError` (unique), `VersionConflictError`, `InvalidEndpointError`.
- Client hooks (`use-entities/attributes/relationships/canvas-state`) follow `use-models.ts`: plain fetch, same-origin cookie, `useState`, optimistic mutate. No zustand.
- UI uses tokens only; the Spresso accent (yellow #FFD60A) → primary (lavender #5e6ad2) remap is preserved. React Flow's CSS is imported inside the client component (not globals.css) to dodge Tailwind v4 layer ordering.
- Migration 0028 was hand-edited idempotent (`CREATE TABLE IF NOT EXISTS` + DO-block FK wrappers) — drizzle-kit 0.31 no longer emits `IF NOT EXISTS`, and the repo has an idempotency test. See [[2026-06-16-migration-generated-not-applied]] for the related apply-the-migration lesson.

## Deferred (NOT built this phase)

AI features (FK inference, auto-describe, synthetic data); realtime socket.io + BroadcastChannel cross-tab sync; undo/redo command stack; Dagre "Tidy" auto-layout; DDL export. The full authenticated Playwright E2E is also pending — the repo has no Playwright harness, so live canvas QA goes through the gstack `/qa` skill.

## Key files

`lib/db/schema.ts` (4 tables) · `lib/model-studio/canvas-validation.ts` · `lib/model-studio/canvas-service.ts` · `lib/model-studio/canvas-types.ts` · `app/api/model-studio/[id]/{entities,attributes,relationships,canvas-state}/…` · `hooks/use-{entities,attributes,relationships,canvas-state}.ts` · `components/model-studio/canvas/*` · `app/workspace/model-studio/[id]/page.tsx`.
