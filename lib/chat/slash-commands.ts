import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { skill, skillInput } from "../db/schema";

export interface SlashCommandResult {
  type: "run";
  skillId: string;
  skillName: string;
  inputs: Array<{
    key: string;
    label: string;
    type: string;
    isRequired: boolean;
    defaultValue: string | null;
  }>;
}

export async function parseSlashCommand(
  text: string,
  userId: string,
): Promise<SlashCommandResult | null> {
  const match = text.match(/^\/run\s+(.+)$/i);
  if (!match) return null;

  const query = match[1].trim().toLowerCase();
  const db = getDb();

  const [found] = await db
    .select({
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
    })
    .from(skill)
    .where(eq(skill.userId, userId))
    .then((rows) =>
      rows.filter(
        (r) =>
          r.slug.toLowerCase() === query ||
          r.name.toLowerCase() === query ||
          r.name.toLowerCase().startsWith(query),
      ),
    );

  if (!found) return null;

  const inputs = await db
    .select({
      key: skillInput.key,
      label: skillInput.label,
      type: skillInput.type,
      isRequired: skillInput.isRequired,
      defaultValue: skillInput.defaultValue,
    })
    .from(skillInput)
    .where(eq(skillInput.skillId, found.id))
    .orderBy(skillInput.sortOrder);

  return {
    type: "run",
    skillId: found.id,
    skillName: found.name,
    inputs,
  };
}

export async function getSkillAutocomplete(
  prefix: string,
  userId: string,
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const db = getDb();
  const all = await db
    .select({ id: skill.id, name: skill.name, slug: skill.slug })
    .from(skill)
    .where(eq(skill.userId, userId));

  if (!prefix) return all.slice(0, 10);
  const lower = prefix.toLowerCase();
  return all
    .filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.slug.toLowerCase().includes(lower),
    )
    .slice(0, 10);
}
