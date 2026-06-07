import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  workflow,
  workflowField,
  workflowStep,
} from "../db/schema";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "./validation";
import type { WorkflowFieldDef, WorkflowStepDef } from "./types";

export async function listWorkflows(userId: string) {
  const db = getDb();
  return db
    .select({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      status: workflow.status,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    })
    .from(workflow)
    .where(eq(workflow.userId, userId))
    .orderBy(desc(workflow.updatedAt));
}

export async function getWorkflow(workflowId: string, userId: string) {
  const db = getDb();

  const [row] = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
    .limit(1);

  if (!row) return null;

  const fields = await db
    .select()
    .from(workflowField)
    .where(eq(workflowField.workflowId, workflowId))
    .orderBy(workflowField.sortOrder);

  const steps = await db
    .select()
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, workflowId))
    .orderBy(workflowStep.sortOrder);

  return { ...row, fields, steps };
}

export async function createWorkflow(
  data: CreateWorkflowInput,
  userId: string,
) {
  const db = getDb();

  const [created] = await db
    .insert(workflow)
    .values({
      name: data.name,
      description: data.description ?? null,
      userId,
    })
    .returning();

  return created;
}

export async function updateWorkflow(
  workflowId: string,
  data: UpdateWorkflowInput,
  userId: string,
) {
  const db = getDb();

  const [existing] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const config = data.config;

  return db.transaction(async (tx) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.status !== undefined) updates.status = data.status;

    const [updated] = await tx
      .update(workflow)
      .set(updates)
      .where(eq(workflow.id, workflowId))
      .returning();

    if (config) {
      if (config.fields !== undefined) {
        await syncWorkflowFields(tx, workflowId, config.fields);
      }
      if (config.steps !== undefined) {
        await syncWorkflowSteps(tx, workflowId, config.steps);
      }
    }

    return updated;
  });
}

export async function deleteWorkflow(workflowId: string, userId: string) {
  const db = getDb();

  const [existing] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
    .limit(1);

  if (!existing) return false;

  await db.delete(workflow).where(eq(workflow.id, workflowId));
  return true;
}

export async function duplicateWorkflow(workflowId: string, userId: string) {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const fields = await db
    .select()
    .from(workflowField)
    .where(eq(workflowField.workflowId, workflowId))
    .orderBy(workflowField.sortOrder);

  const steps = await db
    .select()
    .from(workflowStep)
    .where(eq(workflowStep.workflowId, workflowId))
    .orderBy(workflowStep.sortOrder);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workflow)
      .values({
        name: `${existing.name} (copy)`,
        description: existing.description,
        status: "draft",
        style: existing.style,
        userId,
      })
      .returning();

    if (fields.length > 0) {
      await tx.insert(workflowField).values(
        fields.map((f) => ({
          workflowId: created.id,
          fieldId: f.fieldId,
          type: f.type,
          label: f.label,
          placeholder: f.placeholder,
          isRequired: f.isRequired,
          options: f.options,
          sortOrder: f.sortOrder,
        })),
      );
    }

    if (steps.length > 0) {
      await tx.insert(workflowStep).values(
        steps.map((s) => ({
          workflowId: created.id,
          stepId: s.stepId,
          skillId: s.skillId,
          skillVersion: s.skillVersion,
          model: s.model,
          provider: s.provider,
          prompt: s.prompt,
          capabilities: s.capabilities,
          inputMappings: s.inputMappings,
          overrides: s.overrides,
          editorConfig: s.editorConfig,
          sortOrder: s.sortOrder,
        })),
      );
    }

    return created;
  });
}

// --- Normalized table sync helpers ---

type TxOrDb = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function syncWorkflowFields(
  tx: TxOrDb,
  wfId: string,
  fields: WorkflowFieldDef[],
) {
  await tx
    .delete(workflowField)
    .where(eq(workflowField.workflowId, wfId));

  if (fields.length === 0) return;

  await tx.insert(workflowField).values(
    fields.map((f, i) => ({
      workflowId: wfId,
      fieldId: f.id,
      type: f.type,
      label: f.label,
      placeholder: f.placeholder ?? null,
      isRequired: f.required ?? false,
      options: f.options ?? [],
      sortOrder: i,
    })),
  );
}

async function syncWorkflowSteps(
  tx: TxOrDb,
  wfId: string,
  steps: WorkflowStepDef[],
) {
  await tx
    .delete(workflowStep)
    .where(eq(workflowStep.workflowId, wfId));

  if (steps.length === 0) return;

  await tx.insert(workflowStep).values(
    steps.map((s, i) => ({
      workflowId: wfId,
      stepId: s.id,
      skillId: s.skillId ?? null,
      skillVersion: s.skillVersion ?? null,
      model: s.model ?? "",
      provider: s.provider ?? "",
      prompt: s.prompt ?? "",
      capabilities: s.capabilities ?? [],
      inputMappings: s.inputMappings ?? {},
      overrides: s.overrides ?? {},
      editorConfig: s.editor ?? null,
      sortOrder: s.order ?? i,
    })),
  );
}
