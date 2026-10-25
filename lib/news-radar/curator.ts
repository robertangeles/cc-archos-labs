import { z } from "zod";
import type { RubricConfig } from "./rubric";

// News-radar curator: scores one candidate against the rubric with TypeSafe's
// Jev "System One" model (CEO plan D2, D9, ET3). Scoring only; Jev cannot write.
// Contract verified with a live call on 2026-10-26. Pure of the environment:
// the key arrives as an argument, nothing is logged, and no error message
// carries the key, the request or the response body.

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
// Far below the radar's claim lifetime (plan F3): a stuck call must not outlive the claim.
const DEFAULT_TIMEOUT_MS = 10_000;
// Only 429 and 529 are retried here. Timeouts and network errors are left to
// the radar's database-backed retry, which survives a crashed tick.
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const JITTER_MS = 100;
const RETRY_AFTER_CAP_MS = 10_000;
// feed.ts already caps title and summary; cut again here because this is the
// trust boundary to a third party and a long state is a known Jev weak spot.
const MAX_TITLE_CHARS = 500;
const MAX_SUMMARY_CHARS = 4000;
const MAX_CATEGORY_CHARS = 100;

export interface CuratorInput {
  title: string;
  summary: string;
  category: string | null;
}

export interface QuestionAnswer {
  questionKey: string;
  model: string;
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface CuratorResult {
  /** The model Jev reports back; stored per score row. */
  model: string;
  /** One per rubric question, in rubric order. */
  answers: QuestionAnswer[];
}

export class JevError extends Error {
  override name = "JevError";
}
/** 401 or 403. Never retried; the radar stops the tick. */
export class JevAuthError extends JevError {
  override name = "JevAuthError";
}
/** 400 or 422. Never retried. */
export class JevRequestError extends JevError {
  override name = "JevRequestError";
}
/** 429 after the retries ran out. */
export class JevRateLimitError extends JevError {
  override name = "JevRateLimitError";
}
/** 529 after the retries ran out. */
export class JevOverloadedError extends JevError {
  override name = "JevOverloadedError";
}
export class JevTimeoutError extends JevError {
  override name = "JevTimeoutError";
}
/** HTTP 200 whose body does not match the rubric's answer shape. */
export class JevShapeError extends JevError {
  override name = "JevShapeError";
}

interface ScoreOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

// Control characters and lone surrogates (including one left by a cut through
// an emoji) become spaces, so the text always serialises to valid UTF-8 JSON.
const UNSAFE_CHARS = /[\p{Cc}\p{Cs}]/gu;

function clean(text: string, max: number): string {
  return text.slice(0, max).replace(UNSAFE_CHARS, " ").trim();
}

// The 200 body, checked against this rubric: every question present, a score
// inside its own scale, one probability per level. Unknown fields such as
// `legend` and `usage` are ignored; an unrequested answer id is not.
function answerSchema(rubric: RubricConfig) {
  const shape = Object.fromEntries(
    Object.entries(rubric.questions).map(([id, q]) => {
      const levels = q.criteria.length;
      return [
        id,
        z.object({
          type: z.literal("score"),
          score: z.number().min(0).max(levels - 1),
          confidence: z.number().min(0).max(1),
          probabilities: z
            .record(z.string(), z.number().min(0).max(1))
            .refine(
              (p) =>
                Object.keys(p).length === levels &&
                Array.from({ length: levels }, (_, i) => String(i)).every((k) =>
                  Object.hasOwn(p, k),
                ),
            ),
        }),
      ];
    }),
  );
  return z.object({ model: z.string().min(1), answers: z.strictObject(shape) });
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// Deliberately drops the original error: it can carry request details.
function transportError(err: unknown): JevError {
  return isTimeout(err)
    ? new JevTimeoutError("Jev did not answer in time.")
    : new JevError("Jev could not be reached (network error).");
}

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  return BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * JITTER_MS);
}

/**
 * Score one candidate on every rubric question.
 *
 * @throws JevAuthError (401, 403), JevRequestError (400, 422),
 * JevRateLimitError (429) or JevOverloadedError (529) after retries,
 * JevTimeoutError, JevShapeError, or a plain JevError for a network error or
 * any other status. Nothing else is thrown and no partial result is returned.
 */
export async function scoreCandidate(
  input: CuratorInput,
  rubric: RubricConfig,
  apiKey: string,
  opts: ScoreOptions = {},
): Promise<CuratorResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Candidate text goes only in `state`, never into instructions or criteria:
  // adversarial content is a documented Jev weak spot.
  const body = JSON.stringify({
    model: rubric.model,
    state: {
      title: clean(input.title, MAX_TITLE_CHARS),
      summary: clean(input.summary, MAX_SUMMARY_CHARS),
      category: input.category === null ? null : clean(input.category, MAX_CATEGORY_CHARS),
    },
    questions: Object.fromEntries(
      Object.entries(rubric.questions).map(([id, q]) => [
        id,
        { type: "score", instructions: q.instructions, criteria: q.criteria },
      ]),
    ),
  });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw transportError(err);
    }

    if (res.status === 429 || res.status === 529) {
      if (attempt >= MAX_RETRIES) {
        throw res.status === 429
          ? new JevRateLimitError("Jev is rate limiting requests (HTTP 429).")
          : new JevOverloadedError("Jev is overloaded (HTTP 529).");
      }
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new JevAuthError(`Jev rejected the API key (HTTP ${res.status}).`);
    }
    if (res.status === 400 || res.status === 422) {
      throw new JevRequestError(`Jev rejected the request (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      throw new JevError(`Jev returned an unexpected status (HTTP ${res.status}).`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw err instanceof SyntaxError
        ? new JevShapeError("Jev returned a 200 response that is not valid JSON.")
        : transportError(err);
    }

    const parsed = answerSchema(rubric).safeParse(json);
    if (!parsed.success) {
      // Only the first three path segments: answers.<rubric id>.<field>, never response content.
      const where = parsed.error.issues[0]?.path.slice(0, 3).join(".") || "body";
      throw new JevShapeError(`Jev returned a 200 response that failed validation at ${where}.`);
    }
    const { model, answers } = parsed.data;
    return {
      model,
      answers: Object.keys(rubric.questions).map((questionKey) => {
        const a = answers[questionKey];
        return {
          questionKey,
          model,
          score: a.score,
          confidence: a.confidence,
          probabilities: a.probabilities,
        };
      }),
    };
  }
}
