import { describe, expect, it } from "vitest";
import {
  GATE_MIN_DAYS,
  GATE_MIN_KEEP_RATE,
  GATE_MIN_LABELLED,
  cohortOf,
  currentDecisions,
  gateCounts,
  isEligible,
  melbourneDay,
  missedDays,
  orderEligible,
  shortlistView,
  slotsForMelbourneDay,
  type Candidate,
  type Cutoffs,
  type Label,
  type Tick,
} from "./decide";

// Frozen cut-offs used by every test. The values are arbitrary; the tests
// only care about the comparison direction at each boundary.
const CUTOFFS: Cutoffs = {
  audienceFit: 0.7,
  confidence: 0.6,
  minNoveltyDistance: 0.3,
  dailyCap: 3,
};

// 2026-05-25 03:00Z is 13:00 on 25 May in Melbourne (AEST).
const NOON_MELB = new Date("2026-05-25T03:00:00Z");

function cand(
  id: string,
  over: Partial<Candidate> & { fit?: number; conf?: number } = {},
): Candidate {
  const { fit = 0.9, conf = 0.9, ...rest } = over;
  return {
    id,
    publishedAt: NOON_MELB,
    audienceFit: { score: fit, confidence: conf },
    noveltyDistance: 0.5,
    ...rest,
  };
}

const ids = (list: Candidate[]) => list.map((c) => c.id);

// Deterministic generator so the generated-list tests are reproducible.
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function generated(n: number, seed: number): Candidate[] {
  const rnd = lcg(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `g${String(i).padStart(3, "0")}`,
    publishedAt: new Date(Date.UTC(2026, 4, 20, 0, 0, 0) + Math.floor(rnd() * 6 * 86_400_000)),
    audienceFit: rnd() < 0.1 ? null : { score: rnd(), confidence: rnd() },
    noveltyDistance: rnd() < 0.1 ? null : rnd(),
  }));
}

describe("isEligible", () => {
  const cases: [string, Candidate, boolean][] = [
    ["meets every cut-off", cand("a"), true],
    ["exactly on every cut-off (>= is inclusive)", cand("a", { fit: 0.7, conf: 0.6, noveltyDistance: 0.3 }), true],
    ["audience fit just under T", cand("a", { fit: 0.699 }), false],
    ["confidence just under C", cand("a", { conf: 0.599 }), false],
    ["novelty distance just under M", cand("a", { noveltyDistance: 0.299 }), false],
    ["novelty unavailable (embedding failed)", cand("a", { noveltyDistance: null }), false],
    ["audience fit answer missing", cand("a", { audienceFit: null }), false],
    ["NaN audience fit", cand("a", { fit: NaN }), false],
    ["NaN confidence", cand("a", { conf: NaN }), false],
    ["NaN novelty distance", cand("a", { noveltyDistance: NaN }), false],
    ["Infinity score is garbage, not a perfect score", cand("a", { fit: Infinity }), false],
    ["unreadable publishedAt cannot be placed on a day", cand("a", { publishedAt: new Date("nope") }), false],
  ];

  it.each(cases)("%s", (_name, candidate, expected) => {
    expect(isEligible(candidate, CUTOFFS)).toBe(expected);
  });

  it("is false for every candidate when a cut-off is NaN", () => {
    expect(isEligible(cand("a"), { ...CUTOFFS, audienceFit: NaN })).toBe(false);
  });
});

describe("eligibility depends only on the item's own scores", () => {
  const base = generated(80, 7);

  it("orderEligible keeps exactly the items isEligible accepts", () => {
    expect(new Set(ids(orderEligible(base, CUTOFFS)))).toEqual(
      new Set(ids(base.filter((c) => isEligible(c, CUTOFFS)))),
    );
  });

  it("adding higher-scored items never removes an earlier one", () => {
    const before = ids(orderEligible(base, CUTOFFS));
    const better = Array.from({ length: 25 }, (_, i) =>
      cand(`z${i}`, { fit: 1, conf: 1, noveltyDistance: 1 }),
    );
    const after = new Set(ids(orderEligible([...base, ...better], CUTOFFS)));
    for (const id of before) expect(after.has(id)).toBe(true);
    expect(after.size).toBe(before.length + better.length);
  });

  it("membership of X is the same whatever else is in the list or where it sits", () => {
    const rnd = lcg(99);
    for (const x of base) {
      const others = base.filter((c) => c.id !== x.id && rnd() < 0.5);
      const withX = orderEligible([x, ...others], CUTOFFS);
      const withXLast = orderEligible([...others, x], CUTOFFS);
      const alone = orderEligible([x], CUTOFFS);
      const expected = isEligible(x, CUTOFFS);
      expect(ids(withX).includes(x.id)).toBe(expected);
      expect(ids(withXLast).includes(x.id)).toBe(expected);
      expect(ids(alone).includes(x.id)).toBe(expected);
    }
  });

  it("a later, higher-scored item can push an earlier one behind the cap but never out of the view", () => {
    const early = cand("early", { fit: 0.8 });
    const late = cand("late", { fit: 0.95 });
    const cutoffs = { ...CUTOFFS, dailyCap: 1 };
    const [day] = shortlistView([early, late], cutoffs);
    expect(ids(day.shown)).toEqual(["late"]);
    expect(ids(day.more)).toEqual(["early"]);
    expect(ids(orderEligible([early, late], cutoffs))).toEqual(["late", "early"]);
  });
});

describe("orderEligible", () => {
  const t1 = new Date("2026-05-25T01:00:00Z");
  const t2 = new Date("2026-05-25T02:00:00Z");
  const cases: [string, Candidate[], string[]][] = [
    ["audience fit descending", [cand("a", { fit: 0.8 }), cand("b", { fit: 0.9 })], ["b", "a"]],
    [
      "confidence descending when fit ties",
      [cand("a", { fit: 0.8, conf: 0.7 }), cand("b", { fit: 0.8, conf: 0.9 })],
      ["b", "a"],
    ],
    [
      "fit beats confidence",
      [cand("a", { fit: 0.9, conf: 0.6 }), cand("b", { fit: 0.8, conf: 1 })],
      ["a", "b"],
    ],
    [
      "publishedAt descending when fit and confidence tie",
      [cand("a", { publishedAt: t1 }), cand("b", { publishedAt: t2 })],
      ["b", "a"],
    ],
    [
      "id ascending when every other key ties",
      [cand("c", { publishedAt: t1 }), cand("a", { publishedAt: t1 }), cand("b", { publishedAt: t1 })],
      ["a", "b", "c"],
    ],
    [
      "confidence beats publishedAt",
      [cand("a", { conf: 0.8, publishedAt: t2 }), cand("b", { conf: 0.9, publishedAt: t1 })],
      ["b", "a"],
    ],
    ["ineligible items are dropped", [cand("a"), cand("b", { noveltyDistance: null })], ["a"]],
    ["empty list", [], []],
  ];

  it.each(cases)("%s", (_name, list, expected) => {
    expect(ids(orderEligible(list, CUTOFFS))).toEqual(expected);
  });

  it("is identical for any input permutation (page and gate report agree)", () => {
    // Coarse values force ties on every key.
    const rnd = lcg(3);
    const list = Array.from({ length: 40 }, (_, i) =>
      cand(`i${String(i).padStart(2, "0")}`, {
        fit: 0.7 + Math.floor(rnd() * 3) / 10,
        conf: 0.6 + Math.floor(rnd() * 3) / 10,
        publishedAt: new Date(Date.UTC(2026, 4, 25, Math.floor(rnd() * 3))),
      }),
    );
    const expected = ids(orderEligible(list, CUTOFFS));
    for (let k = 0; k < 10; k++) {
      const shuffled = [...list].sort(() => rnd() - 0.5);
      expect(ids(orderEligible(shuffled, CUTOFFS))).toEqual(expected);
    }
  });

  it("does not mutate its input", () => {
    const list = [cand("b"), cand("a")];
    orderEligible(list, CUTOFFS);
    expect(ids(list)).toEqual(["b", "a"]);
  });
});

describe("melbourneDay", () => {
  const cases: [string, string, string][] = [
    ["late evening UTC is already tomorrow in Melbourne", "2026-05-24T23:00:00Z", "2026-05-25"],
    ["winter late evening UTC rolls the month", "2026-07-31T20:00:00Z", "2026-08-01"],
    ["last second of the day in AEST", "2026-10-03T13:59:59Z", "2026-10-03"],
    ["first second of the day in AEST", "2026-10-03T14:00:00Z", "2026-10-04"],
    // First Sunday of October 2026: 02:00 AEST becomes 03:00 AEDT at 16:00Z on the 3rd.
    ["before the spring-forward jump", "2026-10-03T15:59:59Z", "2026-10-04"],
    ["after the spring-forward jump", "2026-10-03T16:00:00Z", "2026-10-04"],
    ["last second of the 23-hour day", "2026-10-04T12:59:59Z", "2026-10-04"],
    ["first second of the day after spring-forward", "2026-10-04T13:00:00Z", "2026-10-05"],
    // First Sunday of April 2026: 03:00 AEDT becomes 02:00 AEST at 16:00Z on the 4th.
    ["first second of the 25-hour day", "2026-04-04T13:00:00Z", "2026-04-05"],
    ["during the repeated hour (first pass)", "2026-04-04T15:59:59Z", "2026-04-05"],
    ["during the repeated hour (second pass)", "2026-04-04T16:00:00Z", "2026-04-05"],
    ["last second of the 25-hour day", "2026-04-05T13:59:59Z", "2026-04-05"],
    ["first second of the day after fall-back", "2026-04-05T14:00:00Z", "2026-04-06"],
    ["year boundary in summer", "2026-12-31T13:00:00Z", "2027-01-01"],
  ];

  it.each(cases)("%s", (_name, utc, expected) => {
    expect(melbourneDay(new Date(utc))).toBe(expected);
  });
});

describe("shortlistView", () => {
  it("groups by the Melbourne day of publishedAt, newest day first", () => {
    const list = [
      cand("a", { publishedAt: new Date("2026-05-24T12:00:00Z") }), // 24 May 22:00 Melb
      cand("b", { publishedAt: new Date("2026-05-24T23:00:00Z") }), // 25 May 09:00 Melb
      cand("c", { publishedAt: new Date("2026-05-25T03:00:00Z") }), // 25 May 13:00 Melb
    ];
    const view = shortlistView(list, CUTOFFS);
    expect(view.map((d) => d.day)).toEqual(["2026-05-25", "2026-05-24"]);
    expect(ids(view[0].shown).sort()).toEqual(["b", "c"]);
    expect(ids(view[1].shown)).toEqual(["a"]);
  });

  it("splits each day into the first N and the rest, in eligibility order", () => {
    const list = [0.95, 0.9, 0.85, 0.8, 0.75].map((fit, i) => cand(`p${i}`, { fit }));
    const [day] = shortlistView(list, CUTOFFS);
    expect(ids(day.shown)).toEqual(["p0", "p1", "p2"]);
    expect(ids(day.more)).toEqual(["p3", "p4"]);
  });

  it("applies the cap per day, not across days", () => {
    const d1 = [1, 2, 3, 4].map((i) => cand(`x${i}`, { publishedAt: new Date("2026-05-25T03:00:00Z") }));
    const d2 = [1, 2, 3, 4].map((i) => cand(`y${i}`, { publishedAt: new Date("2026-05-26T03:00:00Z") }));
    const view = shortlistView([...d1, ...d2], CUTOFFS);
    expect(view.map((d) => [d.shown.length, d.more.length])).toEqual([[3, 1], [3, 1]]);
  });

  it("leaves out ineligible items and returns [] for an empty list", () => {
    expect(shortlistView([], CUTOFFS)).toEqual([]);
    expect(shortlistView([cand("a", { noveltyDistance: null })], CUTOFFS)).toEqual([]);
  });

  it.each([0, 1, 2, 3, 10, Infinity, NaN, -1, 2.7])(
    "dailyCap %s never changes which items are eligible",
    (dailyCap) => {
      const list = generated(60, 11);
      const view = shortlistView(list, { ...CUTOFFS, dailyCap });
      const inView = view.flatMap((d) => [...d.shown, ...d.more]);
      expect(new Set(ids(inView))).toEqual(new Set(ids(orderEligible(list, CUTOFFS))));
      expect(inView.length).toBe(orderEligible(list, CUTOFFS).length);
    },
  );

  it.each([
    [NaN, 0],
    [-1, 0],
    [0, 0],
    [2.7, 2],
  ])("dailyCap %s shows %s items", (dailyCap, shown) => {
    const list = [cand("a", { fit: 0.9 }), cand("b", { fit: 0.8 }), cand("c", { fit: 0.75 })];
    const [day] = shortlistView(list, { ...CUTOFFS, dailyCap });
    expect(day.shown.length).toBe(shown);
    expect(day.shown.length + day.more.length).toBe(3);
  });
});

describe("slotsForMelbourneDay", () => {
  it.each([
    ["an ordinary AEST day", "2026-05-25", "2026-05-24T14:00:00.000Z", "2026-05-25T12:00:00.000Z"],
    ["an ordinary AEDT day", "2026-12-15", "2026-12-14T14:00:00.000Z", "2026-12-15T12:00:00.000Z"],
    ["the 23-hour spring-forward day", "2026-10-04", "2026-10-03T14:00:00.000Z", "2026-10-04T12:00:00.000Z"],
    ["the 25-hour fall-back day", "2026-04-05", "2026-04-04T14:00:00.000Z", "2026-04-05T12:00:00.000Z"],
  ])("%s has 12 slots 2 hours apart", (_name, day, first, last) => {
    const slots = slotsForMelbourneDay(day);
    expect(slots.length).toBe(12);
    expect(slots[0].toISOString()).toBe(first);
    expect(slots[11].toISOString()).toBe(last);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime() - slots[i - 1].getTime()).toBe(2 * 3_600_000);
    }
    for (const s of slots) expect(melbourneDay(s)).toBe(day);
  });

  it.each([
    ["spring-forward week", "2026-09-28", 10],
    ["fall-back week", "2026-03-30", 10],
  ])("%s: consecutive days cover every UTC slot exactly once", (_name, start, count) => {
    const first = new Date(`${start}T00:00:00Z`);
    const days = Array.from({ length: count }, (_, i) =>
      new Date(first.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );
    const all = days.flatMap(slotsForMelbourneDay).map((d) => d.getTime());
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBe(2 * 3_600_000);
  });

  it.each(["", "nope", "2026-5-25", "2026-02-31", "2026-13-01"])("returns [] for %j", (day) => {
    expect(slotsForMelbourneDay(day)).toEqual([]);
  });
});

describe("missedDays", () => {
  const day = "2026-05-25";
  const full = (d: string): Tick[] =>
    slotsForMelbourneDay(d).map((slotAt) => ({ slotAt, outcome: "ok" as const }));
  const withSlot = (ticks: Tick[], i: number, outcome: Tick["outcome"] | null): Tick[] =>
    ticks.flatMap((t, j) => (j !== i ? [t] : outcome ? [{ ...t, outcome }] : []));

  it("a day with every slot ok is not missed", () => {
    expect(missedDays(full(day), [day])).toEqual([]);
  });

  it("a partial tick still counts", () => {
    expect(missedDays(withSlot(full(day), 4, "partial"), [day])).toEqual([]);
  });

  it.each(["failed", "disabled", null] as const)(
    "one slot %s makes the day missed",
    (outcome) => {
      expect(missedDays(withSlot(full(day), 7, outcome), [day])).toEqual([day]);
    },
  );

  it("the first and last slot of the day matter as much as the middle ones", () => {
    expect(missedDays(withSlot(full(day), 0, null), [day])).toEqual([day]);
    expect(missedDays(withSlot(full(day), 11, null), [day])).toEqual([day]);
  });

  it("an unknown outcome does not count as a good tick", () => {
    const bad = withSlot(full(day), 2, "weird" as Tick["outcome"]);
    expect(missedDays(bad, [day])).toEqual([day]);
  });

  it("a tick off the 2-hour grid does not rescue a missing slot", () => {
    const ticks = withSlot(full(day), 3, null);
    const off = { slotAt: new Date(slotsForMelbourneDay(day)[3].getTime() + 60_000), outcome: "ok" as const };
    expect(missedDays([...ticks, off], [day])).toEqual([day]);
  });

  it("ticks from other days do not rescue this one", () => {
    expect(missedDays(full("2026-05-24"), [day])).toEqual([day]);
  });

  it.each(["2026-10-04", "2026-04-05"])("daylight-saving day %s needs all 12 slots", (d) => {
    expect(missedDays(full(d), [d])).toEqual([]);
    expect(missedDays(withSlot(full(d), 11, "failed"), [d])).toEqual([d]);
  });

  it("returns only the missed days, in the order given", () => {
    const d1 = "2026-05-24";
    const d2 = "2026-05-26";
    const ticks = [...full(d1), ...withSlot(full(day), 5, null), ...full(d2)];
    expect(missedDays(ticks, [d2, day, d1])).toEqual([day]);
  });

  it("no ticks at all means every day is missed; no days means none", () => {
    expect(missedDays([], [day, "2026-05-26"])).toEqual([day, "2026-05-26"]);
    expect(missedDays(full(day), [])).toEqual([]);
  });

  it("a malformed day is missed rather than silently valid", () => {
    expect(missedDays(full(day), ["nope"])).toEqual(["nope"]);
  });
});

describe("cohortOf", () => {
  const row = (rubricVersion: number, iso: string) => ({ rubricVersion, createdAt: new Date(iso) });

  it("is null when the candidate has no score row", () => {
    expect(cohortOf([])).toBeNull();
  });

  it("is the version of the earliest score row, even when a later row has a lower version", () => {
    expect(cohortOf([row(3, "2026-05-02T00:00:00Z"), row(2, "2026-05-03T00:00:00Z")])).toBe(3);
  });

  it("breaks a createdAt tie with the lowest version", () => {
    expect(cohortOf([row(5, "2026-05-02T00:00:00Z"), row(4, "2026-05-02T00:00:00Z")])).toBe(4);
  });

  it("rescoring under another version later never moves the item", () => {
    const first = [row(1, "2026-05-02T00:00:00Z"), row(1, "2026-05-02T00:00:01Z")];
    const later = [row(2, "2026-05-09T00:00:00Z"), row(0, "2026-05-10T00:00:00Z")];
    expect(cohortOf(first)).toBe(1);
    expect(cohortOf([...first, ...later])).toBe(1);
    expect(cohortOf([...later, ...first])).toBe(1);
  });

  it("ignores rows with an unreadable createdAt or version", () => {
    expect(cohortOf([row(9, "nope"), row(2, "2026-05-02T00:00:00Z")])).toBe(2);
    expect(cohortOf([{ rubricVersion: NaN, createdAt: new Date("2026-05-01T00:00:00Z") }])).toBeNull();
  });
});

describe("currentDecisions", () => {
  const l = (candidateId: string, sequence: number, decision: Label["decision"]): Label => ({
    candidateId,
    sequence,
    decision,
  });

  it("the highest sequence wins, whatever the array order", () => {
    const labels = [l("a", 5, "skip"), l("a", 2, "keep"), l("b", 3, "keep")];
    expect(Object.fromEntries(currentDecisions(labels))).toEqual({ a: "skip", b: "keep" });
    expect(Object.fromEntries(currentDecisions([...labels].reverse()))).toEqual({ a: "skip", b: "keep" });
  });

  it("a latest clear means unlabelled", () => {
    expect(currentDecisions([l("a", 1, "keep"), l("a", 2, "clear")]).has("a")).toBe(false);
  });

  it("a label with an unreadable sequence is ignored", () => {
    expect(Object.fromEntries(currentDecisions([l("a", NaN, "keep"), l("a", 1, "skip")]))).toEqual({ a: "skip" });
  });
});

describe("gateCounts", () => {
  const DAYS = ["2026-05-18", "2026-05-19", "2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24"];
  const allOk = (days: string[]): Tick[] =>
    days.flatMap((d) => slotsForMelbourneDay(d).map((slotAt) => ({ slotAt, outcome: "ok" as const })));
  const label = (candidateId: string, sequence: number, decision: Label["decision"]): Label => ({
    candidateId,
    sequence,
    decision,
  });
  const run = (over: Partial<Parameters<typeof gateCounts>[0]> = {}) =>
    gateCounts({ candidates: [], cutoffs: CUTOFFS, labels: [], ticks: allOk(DAYS), days: DAYS, ...over });

  // n eligible candidates e0..e(n-1).
  const eligible = (n: number) => Array.from({ length: n }, (_, i) => cand(`e${i}`));

  it("counts only labelled eligible items in the rate", () => {
    const candidates = eligible(5); // e4 stays unlabelled
    const labels = [
      label("e0", 1, "keep"),
      label("e1", 2, "keep"),
      label("e2", 3, "keep"),
      label("e3", 4, "skip"),
    ];
    const g = run({ candidates, labels });
    expect(g).toMatchObject({ eligibleCount: 5, labelledEligible: 4, kept: 3, skipped: 1, keepRate: 0.75, keptNotEligible: 0 });
  });

  it("a relabel from keep to skip changes the counts but not the population", () => {
    const candidates = eligible(4);
    const labels = [label("e0", 1, "keep"), label("e1", 2, "keep"), label("e2", 3, "skip"), label("e3", 4, "skip")];
    const before = run({ candidates, labels });
    const after = run({ candidates, labels: [...labels, label("e0", 5, "skip")] });
    expect(before).toMatchObject({ eligibleCount: 4, labelledEligible: 4, kept: 2, skipped: 2, keepRate: 0.5 });
    expect(after).toMatchObject({ eligibleCount: 4, labelledEligible: 4, kept: 1, skipped: 3, keepRate: 0.25 });
  });

  it("the highest sequence wins even if it appears first in the array", () => {
    const g = run({ candidates: eligible(1), labels: [label("e0", 9, "skip"), label("e0", 2, "keep")] });
    expect(g).toMatchObject({ labelledEligible: 1, kept: 0, skipped: 1, keepRate: 0 });
  });

  it("a cleared label removes the item from the labelled count", () => {
    const g = run({ candidates: eligible(2), labels: [label("e0", 1, "keep"), label("e0", 2, "clear"), label("e1", 3, "keep")] });
    expect(g).toMatchObject({ eligibleCount: 2, labelledEligible: 1, kept: 1 });
  });

  it("a Kept item that is not eligible is reported separately and not in the rate", () => {
    const candidates = [...eligible(2), cand("miss", { noveltyDistance: null }), cand("nan", { fit: NaN }), cand("low", { fit: 0.1 })];
    const labels = [
      label("e0", 1, "keep"),
      label("e1", 2, "skip"),
      label("miss", 3, "keep"),
      label("nan", 4, "keep"),
      label("low", 5, "skip"), // a Skip on a non-eligible item is not interesting
    ];
    const g = run({ candidates, labels });
    expect(g).toMatchObject({ eligibleCount: 2, labelledEligible: 2, kept: 1, skipped: 1, keepRate: 0.5, keptNotEligible: 2 });
  });

  it("ignores labels for candidates outside the cohort list it was given", () => {
    const g = run({ candidates: eligible(1), labels: [label("e0", 1, "keep"), label("other-cohort", 2, "keep")] });
    expect(g).toMatchObject({ labelledEligible: 1, kept: 1, keptNotEligible: 0 });
  });

  it("zero labels: keepRate is null and no count criterion is met", () => {
    const g = run({ candidates: eligible(3) });
    expect(g).toMatchObject({ eligibleCount: 3, labelledEligible: 0, kept: 0, skipped: 0, keepRate: null });
    expect(g.criteria).toEqual({ days: true, labelled: false, keepRate: false });
    expect(g.measuredCriteriaMet).toBe(false);
  });

  it("is total on empty input", () => {
    const g = gateCounts({ candidates: [], cutoffs: CUTOFFS, labels: [], ticks: [], days: [] });
    expect(g).toMatchObject({ eligibleCount: 0, labelledEligible: 0, keepRate: null, validDays: 0, missedDays: [], keptNotEligible: 0 });
    expect(g.measuredCriteriaMet).toBe(false);
  });

  it("excludes missed-tick days (failed, absent, disabled) so the window extends", () => {
    const [, , failedDay, absentDay, disabledDay] = DAYS;
    const slot3 = (d: string) => slotsForMelbourneDay(d)[3].getTime();
    const ticks = allOk(DAYS).flatMap((t): Tick[] => {
      const ms = t.slotAt.getTime();
      if (ms === slot3(failedDay)) return [{ ...t, outcome: "failed" }];
      if (ms === slot3(disabledDay)) return [{ ...t, outcome: "disabled" }];
      if (ms === slot3(absentDay)) return [];
      return [t];
    });
    const g = run({ ticks });
    expect(g.missedDays).toEqual([failedDay, absentDay, disabledDay]);
    expect(g.validDays).toBe(4);
    expect(g.criteria.days).toBe(false);
    // Three clean days added to the window bring it back to 7 valid days.
    const more = ["2026-05-25", "2026-05-26", "2026-05-27"];
    const extended = run({ ticks: [...ticks, ...allOk(more)], days: [...DAYS, ...more] });
    expect(extended.validDays).toBe(GATE_MIN_DAYS);
    expect(extended.criteria.days).toBe(true);
  });

  it("counts a repeated day once", () => {
    const g = run({ days: [...DAYS, ...DAYS] });
    expect(g.validDays).toBe(7);
  });

  describe("threshold boundaries", () => {
    const lab = (n: number, kept: number) => {
      const candidates = eligible(n);
      const labels = candidates.map((c, i) => label(c.id, i + 1, i < kept ? "keep" : "skip"));
      return { candidates, labels };
    };

    it.each([
      [GATE_MIN_LABELLED - 1, false],
      [GATE_MIN_LABELLED, true],
    ])("%s labelled eligible items -> labelled criterion %s", (n, met) => {
      expect(run(lab(n, n)).criteria.labelled).toBe(met);
    });

    it.each([
      [24, 50, false],
      [25, 50, true],
      [26, 50, true],
    ])("%s kept of %s labelled -> keep-rate criterion %s", (kept, n, met) => {
      const g = run(lab(n, kept));
      expect(g.criteria.keepRate).toBe(met);
      expect(GATE_MIN_KEEP_RATE).toBe(0.5);
    });

    it.each([
      [GATE_MIN_DAYS - 1, false],
      [GATE_MIN_DAYS, true],
    ])("%s valid days -> days criterion %s", (n, met) => {
      const days = DAYS.slice(0, n);
      expect(run({ days, ticks: allOk(days) }).criteria.days).toBe(met);
    });

    it("measuredCriteriaMet needs all three, and a human check is always still required", () => {
      const pass = run(lab(60, 40));
      expect(pass.criteria).toEqual({ days: true, labelled: true, keepRate: true });
      expect(pass.measuredCriteriaMet).toBe(true);
      expect(pass.needsHumanCheck).toBe(true);
      const lowRate = run(lab(60, 20));
      expect(lowRate.measuredCriteriaMet).toBe(false);
      expect(lowRate.needsHumanCheck).toBe(true);
    });
  });
});
