// Create the Nano Banana art-director skill and point the workflow's last step
// at it.
//
//   node --env-file=.env.local scripts/seed-illustration-skill.mjs [--apply]
//
// Prints a plan by default; --apply writes. Idempotent — re-running updates the
// skill in place rather than creating a second one.
//
// The original `archos-stephan-schmitz-image` skill is left untouched so it
// stays available for manual Midjourney work. It cannot be reused as-is: it
// emits `--ar 289:100 --stylize 500 --raw --v 7.0 --q 2`, which Gemini reads as
// prose; it names a living artist, which Google's guidance discourages and
// which reproduces unpredictably; it contradicts itself, asking for "simple
// geometric figures, no detail for detail's sake" and "caricatured proportions
// and expressive faces, satirical" in the same prompt; and its system prompt
// tells the model to ask a clarifying question and WAIT, which in an unattended
// cron means a hung step or a garbage answer.
//
// After running this, re-run scripts/seed-blog-agent-config.mjs so the config's
// fieldMap picks up the new illustration-setting field.

import postgres from "postgres";

const WORKFLOW_NAME = "Archos Labs Blog";
const SKILL_SLUG = "archos-editorial-illustration";
const OLD_SKILL_SLUG = "archos-stephan-schmitz-image";
const PLACE_FIELD_LABEL = "Illustration setting";

const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// The concept-finding half. Style, setting and framing are supplied by code in
// lib/blog-agent/parse-image-prompt.ts, so this prompt does one job: given a
// place, decide where the figure stands, where the light comes from, and what
// is quietly impossible about the scene.
const SYSTEM_PROMPT = `You are the art director for a serious business magazine. You commission one illustration per feature, and it has to carry the argument on its own without a caption.

You never ask clarifying questions and you never wait for an answer. This runs unattended. If the article is thin, pick the strongest idea in it and commit.

You do not describe style, palette, texture or rendering. Those are decided elsewhere and anything you say about them is discarded. Describe only the scene.`;

const PROMPT_TEMPLATE = `Read the article and write ONE scene description for the illustrator. Do not ask questions. Do not summarise. Do not explain. Decide.

ARTICLE:
{{article_draft}}

THE SETTING AND THE REPEATED ELEMENT, BOTH GIVEN TO YOU AND NEITHER YOURS TO CHANGE:
{{image_place}}

Use exactly that setting and exactly that element. Do not substitute a different
one, and do not add a second kind of repeated object beside it. If nothing is
named above, use a large, bare, mostly empty interior with three identical
windows.

Build the scene from three parts.

A FIGURE — one small anonymous person, seen from behind or in silhouette, dwarfed by the space. No face, no expression. They stand in for the reader.

THE REPEATED ELEMENT — named for you above. Identical is the whole point: the viewer must see at a glance that these things ought to match. Place them clearly and evenly so the repetition reads instantly.

THE IMPOSSIBILITY — the last sentence of the block above tells you exactly what is wrong with this scene. Build the picture around that and nothing else. Do not add a second impossibility beside it, and do not fall back on shadows disagreeing unless that is what you were told.

HARD RULES:

1. Nothing readable. No letters, words, labels, signage, numerals or handwriting. And nothing whose purpose is to carry markings — no documents, ledgers, books, screens, monitors, phones, charts, rulers, clocks, dials or gauges. Those objects drag text into the picture whether you ask for it or not.
2. Never name a real person, company, brand, product or artist.
3. The impossibility must be visible at thumbnail size. Not a small detail in a corner.
4. Do not draw the article's literal subject matter. If it is about records, draw no records. The metaphor lives in space and light.
5. Keep the place bare. No furniture, clutter, beams, railings, machinery, plants or scenery beyond what is named. Everything you add makes the idea harder to see.
6. Do not draw doors or doorways unless the element named above is a door. They are the obvious choice and they have been overused; the setting you were given has its own repeated thing.

OUTPUT exactly this and nothing else:

SCENE: [one paragraph of flowing narrative prose. Name where the figure stands, where the light comes from, and precisely how the impossibility looks. Written for someone who will draw it. No keyword lists, no style words.]
ALT: [under 125 characters. Describe only what is literally shown.]`;

function log(...args) {
  console.log(...args);
}

try {
  const host = new URL(process.env.DATABASE_URL).hostname;
  log(`Target: ${host} (${host === "127.0.0.1" ? "DEV" : "!!! NOT DEV !!!"})`);
  log(apply ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

  const [wf] = await sql`
    SELECT id, user_id FROM workflow WHERE name = ${WORKFLOW_NAME} LIMIT 1
  `;
  if (!wf) throw new Error(`No workflow named "${WORKFLOW_NAME}".`);

  const [old] = await sql`
    SELECT id, default_model, temperature, max_tokens
      FROM skill WHERE slug = ${OLD_SKILL_SLUG} LIMIT 1
  `;
  if (!old) throw new Error(`No skill "${OLD_SKILL_SLUG}" to copy settings from.`);

  // The last step is the illustration step.
  const steps = await sql`
    SELECT ws.id, ws.step_id, ws.sort_order, ws.skill_id, ws.input_mappings, sk.slug
      FROM workflow_step ws LEFT JOIN skill sk ON sk.id = ws.skill_id
     WHERE ws.workflow_id = ${wf.id}
     ORDER BY ws.sort_order
  `;
  const imageStep = steps[steps.length - 1];
  if (imageStep.slug !== OLD_SKILL_SLUG && imageStep.slug !== SKILL_SLUG) {
    throw new Error(
      `Last step is "${imageStep.slug}", expected the illustration step. Not touching it.`,
    );
  }

  // --- the illustration-setting input field --------------------------------
  const fields = await sql`
    SELECT field_id, label, sort_order FROM workflow_field
     WHERE workflow_id = ${wf.id} ORDER BY sort_order
  `;
  let placeField = fields.find((f) => f.label === PLACE_FIELD_LABEL);

  log(`workflow      ${wf.id}`);
  log(`image step    sort_order ${imageStep.sort_order}, currently "${imageStep.slug}"`);
  log(`place field   ${placeField ? `exists (${placeField.field_id})` : "will be created"}`);
  log(`skill         ${SKILL_SLUG} (model ${old.default_model}, temp ${old.temperature})`);
  log(`old skill     ${OLD_SKILL_SLUG} left untouched for manual Midjourney use`);

  if (!apply) {
    log("\nDry run — nothing written.");
  } else {
    if (!placeField) {
      // Field ids are runtime data the builder generates; match its shape.
      const fieldId = `imgplace${Math.random().toString(36).slice(2, 12)}`;
      await sql`
        INSERT INTO workflow_field
          ("workflow_id","field_id","label","type","is_required","options",
           "sort_order","placeholder")
        VALUES (${wf.id}, ${fieldId}, ${PLACE_FIELD_LABEL}, 'text', false,
                ${sql.json([])}, ${fields.length},
                'Left blank, the art director picks its own setting')
      `;
      placeField = { field_id: fieldId };
      log(`\n  created field ${fieldId}`);
    }

    // `skill_user_slug_idx` is a plain btree, not a unique constraint, so
    // ON CONFLICT has nothing to match. Look it up and branch instead.
    const DESCRIPTION =
      "Turns a finished article into one scene description for the house " +
      "illustration style. Style, setting and framing are applied in code; " +
      "this decides the concept.";

    const [found] = await sql`
      SELECT id FROM skill
       WHERE slug = ${SKILL_SLUG} AND user_id = ${wf.user_id} LIMIT 1
    `;

    let skillId;
    if (found) {
      await sql`
        UPDATE skill
           SET system_prompt = ${SYSTEM_PROMPT},
               prompt_template = ${PROMPT_TEMPLATE},
               description = ${DESCRIPTION},
               updated_at = now()
         WHERE id = ${found.id}
      `;
      skillId = found.id;
      log(`  updated skill ${skillId}`);
    } else {
      const [created] = await sql`
        INSERT INTO skill
          ("slug","name","description","category","user_id","system_prompt",
           "prompt_template","default_model","temperature","max_tokens")
        VALUES (
          ${SKILL_SLUG}, 'Archos Editorial Illustration', ${DESCRIPTION},
          'generate', ${wf.user_id}, ${SYSTEM_PROMPT}, ${PROMPT_TEMPLATE},
          ${old.default_model}, ${old.temperature}, ${old.max_tokens}
        )
        RETURNING id
      `;
      skillId = created.id;
      log(`  created skill ${skillId}`);
    }
    const skillRow = { id: skillId };

    // Without this row the step's output lands under the key "result", not
    // "image_prompt" — getSkillConfig (lib/workflows/executor.ts:419) defaults
    // to "result" when a skill declares no output. run.ts then finds no image
    // prompt and every post silently gets the fallback illustration. Caught by
    // a real end-to-end run; no unit test sees it, because they all mock the
    // workflow.
    const [existingOutput] = await sql`
      SELECT id FROM skill_output WHERE skill_id = ${skillId} LIMIT 1
    `;
    if (existingOutput) {
      await sql`
        UPDATE skill_output SET key = 'image_prompt', updated_at = now()
         WHERE id = ${existingOutput.id}
      `;
      log("  output key confirmed: image_prompt");
    } else {
      await sql`
        INSERT INTO skill_output ("skill_id","key","type","label","sort_order")
        VALUES (${skillId}, 'image_prompt', 'markdown', 'Result', 0)
      `;
      log("  declared output key: image_prompt");
    }

    // Preserve the article_draft mapping; add the setting.
    const existing =
      typeof imageStep.input_mappings === "string"
        ? JSON.parse(imageStep.input_mappings)
        : (imageStep.input_mappings ?? {});
    const mappings = { ...existing, image_place: placeField.field_id };

    await sql`
      UPDATE workflow_step
         SET skill_id = ${skillRow.id},
             input_mappings = ${sql.json(mappings)}
       WHERE id = ${imageStep.id}
    `;
    log(`  repointed step ${imageStep.step_id} -> ${SKILL_SLUG}`);
    log(`  mappings ${JSON.stringify(mappings)}`);
    log("\nNow re-run: node --env-file=.env.local scripts/seed-blog-agent-config.mjs");
  }
} catch (err) {
  console.error(`\n  ERROR: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
