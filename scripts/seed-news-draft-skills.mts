// Create the skills the news drafting pipeline reads, in whichever database
// DATABASE_URL points at. Idempotent, and it never overwrites a skill that exists:
// Rob's edits in the admin win.
//
//   node --env-file=.env.local --no-warnings --conditions=react-server --import tsx \
//     scripts/seed-news-draft-skills.mts [--dry-run]
//
// --dry-run prints what it would create and writes nothing. To target PROD, set
// DATABASE_URL to the PROD url explicitly in the same command (see the runbook);
// every db:* script defaults to DEV.
//
// The essay skill is derived from the target database's own "Archos Paul Graham
// Essays", so PROD's copy of Rob's skill is the base, not DEV's.

import { eq } from "drizzle-orm";
import { getDb } from "../lib/db";
import { skill } from "../lib/db/schema";
import { createSkill, getSkill } from "../lib/skills/service";
import { deriveFactcheckSkill, NEWS_SKILLS, type SkillSeed } from "../lib/news-radar/draft/seed-skills";

const dry = process.argv.includes("--dry-run");
const host = new URL(process.env.DATABASE_URL ?? "postgres://none").hostname;
console.log(`Target database host: ${host}${dry ? " (dry run)" : ""}`);

const db = getDb();
const [pg] = await db.select({ id: skill.id, userId: skill.userId }).from(skill).where(eq(skill.slug, "archos-paul-graham-essays")).limit(1);
if (!pg?.userId) {
  console.error('This database has no "archos-paul-graham-essays" skill, so there is no owner and no base to derive the news essay skill from. Stopping.');
  process.exit(1);
}
const base = await getSkill(pg.id, pg.userId);
if (!base) throw new Error("could not load the Paul Graham skill");

const seeds: SkillSeed[] = [
  ...NEWS_SKILLS,
  deriveFactcheckSkill({
    template: base.promptTemplate ?? "",
    system: base.systemPrompt,
    inputs: base.inputs.map((i) => ({ key: i.key, type: i.type as "text" | "multiline" | "select", label: i.label, description: i.description ?? undefined, required: i.isRequired, defaultValue: i.defaultValue ?? undefined, options: (i.options as string[]) ?? [] })),
    outputs: base.outputs.map((o) => ({ key: o.key, type: o.type as "text" | "markdown" | "json", label: o.label, description: o.description ?? undefined })),
  }),
];

let created = 0;
for (const s of seeds) {
  const [exists] = await db.select({ id: skill.id }).from(skill).where(eq(skill.slug, s.slug)).limit(1);
  if (exists) {
    console.log(`SKIP    ${s.slug} (exists, left as it is)`);
    continue;
  }
  if (dry) {
    console.log(`WOULD CREATE ${s.slug}  [${s.defaultModel}]  ${s.template.length} chars`);
    continue;
  }
  const row = await createSkill(
    { name: s.name, description: s.description, category: s.category, promptTemplate: s.template, systemPrompt: s.system ?? undefined, defaultModel: s.defaultModel, maxTokens: s.maxTokens, inputs: s.inputs, outputs: s.outputs },
    pg.userId,
  );
  if (row.slug !== s.slug) console.warn(`NOTE    ${s.slug}: created with slug "${row.slug}" (the app derives it from the name)`);
  console.log(`CREATED ${row.slug}`);
  created++;
}
console.log(dry ? "Dry run: nothing written." : `Done. ${created} created.`);
process.exit(0);
