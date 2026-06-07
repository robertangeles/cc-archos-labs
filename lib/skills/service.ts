import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  skill,
  skillInput,
  skillOutput,
  skillVersion,
} from "../db/schema";
import type { CreateSkillInput, UpdateSkillInput } from "./validation";
import type { SkillVersionConfig } from "./types";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function uniqueSlug(userId: string, baseName: string): Promise<string> {
  const db = getDb();
  const base = slugify(baseName);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const existing = await db
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.userId, userId), eq(skill.slug, candidate)))
      .limit(1);

    if (existing.length === 0) return candidate;
    suffix++;
    candidate = `${base}-${suffix}`;
  }
}

export async function listSkills(userId: string) {
  const db = getDb();
  return db
    .select({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      currentVersion: skill.currentVersion,
      defaultModel: skill.defaultModel,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
    })
    .from(skill)
    .where(eq(skill.userId, userId))
    .orderBy(desc(skill.updatedAt));
}

export async function getSkill(skillId: string, userId: string) {
  const db = getDb();

  const [row] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.userId, userId)))
    .limit(1);

  if (!row) return null;

  const inputs = await db
    .select()
    .from(skillInput)
    .where(eq(skillInput.skillId, skillId))
    .orderBy(skillInput.sortOrder);

  const outputs = await db
    .select()
    .from(skillOutput)
    .where(eq(skillOutput.skillId, skillId))
    .orderBy(skillOutput.sortOrder);

  return { ...row, inputs, outputs };
}

export async function createSkill(data: CreateSkillInput, userId: string) {
  const db = getDb();
  const slug = await uniqueSlug(userId, data.name);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(skill)
      .values({
        slug,
        name: data.name,
        description: data.description,
        category: data.category,
        userId,
        promptTemplate: data.promptTemplate,
        systemPrompt: data.systemPrompt ?? null,
        defaultModel: data.defaultModel ?? null,
        temperature: data.temperature != null ? String(data.temperature) : null,
        maxTokens: data.maxTokens ?? null,
      })
      .returning();

    if (data.inputs?.length) {
      await tx.insert(skillInput).values(
        data.inputs.map((inp, i) => ({
          skillId: created.id,
          key: inp.key,
          type: inp.type,
          label: inp.label,
          description: inp.description ?? null,
          isRequired: inp.required,
          defaultValue: inp.defaultValue ?? null,
          options: inp.options ?? [],
          sortOrder: i,
        })),
      );
    }

    if (data.outputs?.length) {
      await tx.insert(skillOutput).values(
        data.outputs.map((out, i) => ({
          skillId: created.id,
          key: out.key,
          type: out.type,
          label: out.label,
          description: out.description ?? null,
          sortOrder: i,
        })),
      );
    }

    const versionConfig: SkillVersionConfig = {
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      promptTemplate: data.promptTemplate,
      systemPrompt: data.systemPrompt,
      temperature: data.temperature ?? 0.7,
      maxTokens: data.maxTokens ?? 4000,
      defaultModel: data.defaultModel ?? "",
    };

    await tx.insert(skillVersion).values({
      skillId: created.id,
      version: 1,
      config: versionConfig,
      changelog: "Initial version",
    });

    return created;
  });
}

export async function updateSkill(
  skillId: string,
  data: UpdateSkillInput,
  userId: string,
) {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const promptChanged =
    data.promptTemplate !== undefined ||
    data.systemPrompt !== undefined ||
    data.inputs !== undefined ||
    data.outputs !== undefined;

  return db.transaction(async (tx) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.category !== undefined) updates.category = data.category;
    if (data.promptTemplate !== undefined)
      updates.promptTemplate = data.promptTemplate;
    if (data.systemPrompt !== undefined)
      updates.systemPrompt = data.systemPrompt;
    if (data.defaultModel !== undefined) updates.defaultModel = data.defaultModel;
    if (data.temperature !== undefined)
      updates.temperature = String(data.temperature);
    if (data.maxTokens !== undefined) updates.maxTokens = data.maxTokens;

    if (promptChanged) {
      const newVersion = existing.currentVersion + 1;
      updates.currentVersion = newVersion;

      const currentInputs = data.inputs ??
        (await tx
          .select()
          .from(skillInput)
          .where(eq(skillInput.skillId, skillId))
          .orderBy(skillInput.sortOrder)
        ).map((i) => ({
          key: i.key,
          type: i.type as "text" | "multiline" | "select",
          label: i.label,
          description: i.description ?? undefined,
          required: i.isRequired,
          defaultValue: i.defaultValue ?? undefined,
          options: (i.options as string[]) ?? undefined,
        }));

      const currentOutputs = data.outputs ??
        (await tx
          .select()
          .from(skillOutput)
          .where(eq(skillOutput.skillId, skillId))
          .orderBy(skillOutput.sortOrder)
        ).map((o) => ({
          key: o.key,
          type: o.type as "text" | "markdown" | "json",
          label: o.label,
          description: o.description ?? undefined,
        }));

      const versionConfig: SkillVersionConfig = {
        inputs: currentInputs,
        outputs: currentOutputs,
        promptTemplate:
          data.promptTemplate ?? existing.promptTemplate,
        systemPrompt: data.systemPrompt ?? existing.systemPrompt ?? undefined,
        temperature:
          data.temperature ?? (existing.temperature ? Number(existing.temperature) : 0.7),
        maxTokens: data.maxTokens ?? existing.maxTokens ?? 4000,
        defaultModel: data.defaultModel ?? existing.defaultModel ?? "",
      };

      await tx.insert(skillVersion).values({
        skillId,
        version: newVersion,
        config: versionConfig,
        changelog: data.changelog ?? null,
      });

      if (data.inputs) {
        await tx.delete(skillInput).where(eq(skillInput.skillId, skillId));
        if (data.inputs.length) {
          await tx.insert(skillInput).values(
            data.inputs.map((inp, i) => ({
              skillId,
              key: inp.key,
              type: inp.type,
              label: inp.label,
              description: inp.description ?? null,
              isRequired: inp.required,
              defaultValue: inp.defaultValue ?? null,
              options: inp.options ?? [],
              sortOrder: i,
            })),
          );
        }
      }

      if (data.outputs) {
        await tx.delete(skillOutput).where(eq(skillOutput.skillId, skillId));
        if (data.outputs.length) {
          await tx.insert(skillOutput).values(
            data.outputs.map((out, i) => ({
              skillId,
              key: out.key,
              type: out.type,
              label: out.label,
              description: out.description ?? null,
              sortOrder: i,
            })),
          );
        }
      }
    }

    const [updated] = await tx
      .update(skill)
      .set(updates)
      .where(eq(skill.id, skillId))
      .returning();

    return updated;
  });
}

export async function deleteSkill(skillId: string, userId: string) {
  const db = getDb();

  const [existing] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.userId, userId)))
    .limit(1);

  if (!existing) return false;

  await db.delete(skill).where(eq(skill.id, skillId));
  return true;
}

export async function listVersions(skillId: string, userId: string) {
  const db = getDb();

  const [row] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.id, skillId), eq(skill.userId, userId)))
    .limit(1);

  if (!row) return null;

  return db
    .select({
      id: skillVersion.id,
      version: skillVersion.version,
      changelog: skillVersion.changelog,
      createdAt: skillVersion.createdAt,
    })
    .from(skillVersion)
    .where(eq(skillVersion.skillId, skillId))
    .orderBy(desc(skillVersion.version));
}
