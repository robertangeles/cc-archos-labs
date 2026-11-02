// Create the skills the news drafting pipeline reads, in whichever database
// DATABASE_URL points at. Idempotent, and it never overwrites a skill that exists:
// Rob's edits win.
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
import { deriveFactcheckSkill, NEWS_SKILLS, type SkillSeed } from "../lib/news-radar/draft/seed-skills";

const dry = process.argv.includes("--dry-run");
const host = new URL(process.env.DATABASE_URL ?? "postgres://none").hostname;
console.log(`Target database host: ${host}${dry ? " (dry run)" : ""}`);

const db = getDb();
const [pg] = await db
  .select({ id: skill.id, userId: skill.userId, template: skill.promptTemplate, system: skill.systemPrompt })
  .from(skill)
  .where(eq(skill.slug, "archos-paul-graham-essays"))
  .limit(1);
if (!pg?.userId) {
  console.error('This database has no "archos-paul-graham-essays" skill, so there is no owner and no base to derive the news essay skill from. Stopping.');
  process.exit(1);
}

const seeds: SkillSeed[] = [...NEWS_SKILLS, deriveFactcheckSkill({ template: pg.template, system: pg.system })];

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
  await db.insert(skill).values({
    slug: s.slug,
    name: s.name,
    description: s.description,
    category: s.category,
    userId: pg.userId,
    promptTemplate: s.template,
    systemPrompt: s.system,
    defaultModel: s.defaultModel,
    maxTokens: s.maxTokens,
  });
  console.log(`CREATED ${s.slug}`);
  created++;
}
console.log(dry ? "Dry run: nothing written." : `Done. ${created} created.`);
process.exit(0);
