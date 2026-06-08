import { getDb } from "@/lib/db";
import { skill, skillExecution } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

interface RecordExecutionParams {
  userId: string;
  skillId: string;
  model: string;
  tokenCount: number | null;
}

export async function recordSkillExecution(params: RecordExecutionParams) {
  const db = getDb();

  await db.insert(skillExecution).values({
    userId: params.userId,
    skillId: params.skillId,
    model: params.model,
    tokenCount: params.tokenCount,
  });

  await db
    .update(skill)
    .set({
      lastUsedAt: sql`now()`,
      useCount: sql`${skill.useCount} + 1`,
    })
    .where(eq(skill.id, params.skillId));
}
