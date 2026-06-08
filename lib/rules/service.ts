import "server-only";
import { and, asc, eq, max } from "drizzle-orm";
import { getDb } from "../db";
import { userRule } from "../db/schema";
import type { CreateRuleInput, UpdateRuleInput } from "./validation";

export async function listRules(userId: string) {
  const db = getDb();
  return db
    .select({
      id: userRule.id,
      name: userRule.name,
      category: userRule.category,
      content: userRule.content,
      isEnabled: userRule.isEnabled,
      sortOrder: userRule.sortOrder,
      createdAt: userRule.createdAt,
      updatedAt: userRule.updatedAt,
    })
    .from(userRule)
    .where(eq(userRule.userId, userId))
    .orderBy(asc(userRule.sortOrder), asc(userRule.createdAt));
}

export async function getRule(ruleId: string, userId: string) {
  const db = getDb();
  const [rule] = await db
    .select({
      id: userRule.id,
      name: userRule.name,
      category: userRule.category,
      content: userRule.content,
      isEnabled: userRule.isEnabled,
      sortOrder: userRule.sortOrder,
      createdAt: userRule.createdAt,
      updatedAt: userRule.updatedAt,
    })
    .from(userRule)
    .where(and(eq(userRule.id, ruleId), eq(userRule.userId, userId)))
    .limit(1);
  return rule ?? null;
}

export async function createRule(data: CreateRuleInput, userId: string) {
  const db = getDb();

  const [maxSort] = await db
    .select({ val: max(userRule.sortOrder) })
    .from(userRule)
    .where(eq(userRule.userId, userId));

  const nextSort = (maxSort?.val ?? -1) + 1;

  const [created] = await db
    .insert(userRule)
    .values({
      userId,
      name: data.name,
      category: data.category,
      content: data.content,
      isEnabled: data.isEnabled ?? true,
      sortOrder: nextSort,
    })
    .returning();

  return created;
}

export async function updateRule(
  ruleId: string,
  data: UpdateRuleInput,
  userId: string,
) {
  const db = getDb();

  const [existing] = await db
    .select({ id: userRule.id })
    .from(userRule)
    .where(and(eq(userRule.id, ruleId), eq(userRule.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.content !== undefined) updates.content = data.content;
  if (data.isEnabled !== undefined) updates.isEnabled = data.isEnabled;

  const [updated] = await db
    .update(userRule)
    .set(updates)
    .where(eq(userRule.id, ruleId))
    .returning();

  return updated;
}

export async function deleteRule(ruleId: string, userId: string) {
  const db = getDb();

  const [existing] = await db
    .select({ id: userRule.id })
    .from(userRule)
    .where(and(eq(userRule.id, ruleId), eq(userRule.userId, userId)))
    .limit(1);

  if (!existing) return false;

  await db.delete(userRule).where(eq(userRule.id, ruleId));
  return true;
}

export async function toggleRule(
  ruleId: string,
  isEnabled: boolean,
  userId: string,
) {
  const db = getDb();

  const [existing] = await db
    .select({ id: userRule.id })
    .from(userRule)
    .where(and(eq(userRule.id, ruleId), eq(userRule.userId, userId)))
    .limit(1);

  if (!existing) return null;

  const [updated] = await db
    .update(userRule)
    .set({ isEnabled, updatedAt: new Date() })
    .where(eq(userRule.id, ruleId))
    .returning({ id: userRule.id, isEnabled: userRule.isEnabled });

  return updated;
}

export async function getEnabledRules(userId: string) {
  const db = getDb();
  return db
    .select({
      name: userRule.name,
      content: userRule.content,
    })
    .from(userRule)
    .where(and(eq(userRule.userId, userId), eq(userRule.isEnabled, true)))
    .orderBy(asc(userRule.sortOrder), asc(userRule.createdAt));
}

export function formatRulesForInjection(
  rules: { name: string; content: string }[],
): string | null {
  if (rules.length === 0) return null;
  const block = rules
    .map((r) => `[${r.name}]\n${r.content}`)
    .join("\n\n");
  return `GLOBAL RULES (always follow these):\n\n${block}`;
}
