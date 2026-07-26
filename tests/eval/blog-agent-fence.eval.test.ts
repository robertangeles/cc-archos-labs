import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { parseDraft } from "@/lib/blog-agent/parse-draft";

// E3 verification gate for the untrusted-input fence.
//
// The fence (lib/workflows/executor.ts) wraps upstream step output in markers
// and appends an instruction to the step's system prompt. That instruction
// becomes part of prompts the Archos Labs Blog skills were hand-tuned against,
// so "did it degrade the output?" is an empirical question, not a review one.
//
// Cheap by construction: rather than re-running the whole 5-step workflow
// (~4 min, ~$1, and the deep-research step is unfenced anyway because it has
// no step_ inputs), this replays ONLY the essay step against run-00's
// historical research/thesis/steelman. Same inputs, same skill, one Sonnet
// call — a direct A/B against a draft we already have on disk.
//
// Opt-in: it costs real money and hits a live model, so it does not fire on a
// normal `pnpm eval`. Run it deliberately:
//
//   RUN_FENCE_EVAL=1 pnpm eval tests/eval/blog-agent-fence.eval.test.ts
//
// Needs DATABASE_URL pointing at DEV (the `pnpm eval` script loads .env.local).

const ENABLED = process.env.RUN_FENCE_EVAL === "1";
const WORKFLOW_ID = "987cd9bb-a9ff-4877-b9e7-e5517eac7ec4";

describe.skipIf(!ENABLED)("fence does not degrade the essay step", () => {
  it("produces a draft that still parses and still reads like the baseline", async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

    try {
      const [run] = await sql`
        select inputs, step_results
        from workflow_execution_run
        where workflow_id = ${WORKFLOW_ID} and status = 'completed'
        order by created_at desc
        limit 1
      `;
      expect(run, "need a completed historical run to replay").toBeTruthy();

      const stepResults = run.step_results as Array<{
        stepId: string;
        outputs: Record<string, string>;
      }>;
      const baseline = stepResults.find((s) => s.outputs?.article_draft)!;
      const baselineParsed = parseDraft(baseline.outputs.article_draft)!;

      const steps = await sql`
        select step_id, skill_id, model, prompt, input_mappings, overrides
        from workflow_step
        where workflow_id = ${WORKFLOW_ID}
        order by sort_order
      `;
      const row = steps.find((s) => s.step_id === baseline.stepId)!;
      expect(row, "essay step must still exist").toBeTruthy();

      // The raw postgres driver returns snake_case; executeStep reads the
      // Drizzle camelCase shape. Passing the row straight through leaves
      // skillId undefined, so loadSkillConfig never runs and promptTemplate
      // falls back to workflow_step.prompt — which is "" for every step in
      // this workflow, because the prompts live on the skills. OpenRouter
      // then rejects the empty prompt with "Input must have at least 1 token."
      // The raw driver hands back jsonb columns inconsistently: some rows come
      // through as objects, some as JSON strings. Drizzle's jsonb type parses
      // them; here we must. Object.entries() on a string iterates characters,
      // which silently resolves zero inputs and sends the model a prompt full
      // of unfilled {{placeholders}}.
      const asObject = (v: unknown): Record<string, string> =>
        typeof v === "string" ? JSON.parse(v) : ((v ?? {}) as Record<string, string>);

      const essayStep = {
        stepId: row.step_id,
        skillId: row.skill_id,
        model: row.model,
        prompt: row.prompt,
        inputMappings: asObject(row.input_mappings),
        overrides: asObject(row.overrides),
      };
      expect(
        Object.keys(essayStep.inputMappings).length,
        "essay step must have input mappings",
      ).toBeGreaterThan(0);
      expect(essayStep.skillId, "essay step must resolve a skill").toBeTruthy();

      // Rebuild the context the essay step saw: workflow inputs plus every
      // successful prior step under both key forms the executor writes.
      const context: Record<string, string> = { ...(run.inputs as Record<string, string>) };
      for (const s of stepResults) {
        if (s.stepId === baseline.stepId) break;
        for (const [k, v] of Object.entries(s.outputs ?? {})) {
          context[`step_${s.stepId}.${k}`] = v;
          context[`step_${s.stepId}.result`] = v;
        }
      }

      const { executeStep } = await import("@/lib/workflows/executor");
      const { result } = await executeStep(
        essayStep as never,
        context,
        "",
        {},
      );

      expect(result.status, result.error ?? "").toBe("success");
      const fenced = result.outputs.article_draft ?? Object.values(result.outputs)[0];

      // Diagnostics BEFORE assertions: when this gate fails, the first
      // question is always "what did the model actually emit?", and a bare
      // "expected null not to be null" cannot answer it.
      console.log("=== FENCED OUTPUT (first 900 chars) ===");
      console.log(fenced.slice(0, 900));
      console.log("=== SEO FIELD PRESENCE ===");
      for (const label of ["URL slug", "SEO title", "Meta description", "Tags"]) {
        console.log(
          `  ${label}: ${new RegExp(`\\*\\*${label}:?\\*\\*`).test(fenced)}`,
        );
      }
      console.log(`  leading H1: ${/^#\s+/.test(fenced.trim())}`);
      console.log(`  marker leak: ${/UNTRUSTED_[0-9a-f-]+/.test(fenced)}`);

      // 1. The output contract still holds — this is what the parser depends on.
      const parsed = parseDraft(fenced);
      expect(parsed, "fenced draft must still parse").not.toBeNull();

      // 2. The fence markers must never leak into published prose.
      expect(fenced).not.toMatch(/UNTRUSTED_[0-9a-f-]+/);
      expect(fenced).not.toContain("<<<");

      // 3. Length stays in the same band as the baseline (±40%). A fence that
      //    made the model terse or rambling would show up here first.
      const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
      const baseWords = words(baselineParsed.contentMd);
      const newWords = words(parsed!.contentMd);
      expect(newWords).toBeGreaterThan(baseWords * 0.6);
      expect(newWords).toBeLessThan(baseWords * 1.4);

      // 4. Still structured as an essay, not a summary of the fenced block.
      expect(parsed!.contentMd.match(/^## /gm)?.length ?? 0).toBeGreaterThanOrEqual(2);

      // Printed for the human half of the gate: read both before merging.
      console.log(
        JSON.stringify(
          {
            baselineWords: baseWords,
            fencedWords: newWords,
            baselineTitle: baselineParsed.title,
            fencedTitle: parsed!.title,
            fencedDraft: fenced,
          },
          null,
          2,
        ),
      );
    } finally {
      await sql.end();
    }
  }, 120_000);
});
