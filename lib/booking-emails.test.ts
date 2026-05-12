import { describe, expect, it } from "vitest";
import {
  buildBookingConfirmationEmail,
  buildBookingNoshowRecoveryEmail,
  buildBookingPostcallFollowupEmail,
  buildBookingPrecallBriefEmail,
  buildBookingReminder1hEmail,
  buildBookingReminder24hEmail,
} from "./booking-emails";

// Smoke + security checks. Real visual QA happens by sending to live
// inboxes in Lane B/C/D. Here we just verify:
//   - each function returns the {subject, text, html} contract,
//   - subjects follow the §17.12 voice rules (no emoji, no "!"),
//   - user-supplied content is HTML-escaped to defend against XSS in
//     mail clients that auto-render attacker-injected names.

const SUBJECT_FORBIDDEN = /[!\p{Extended_Pictographic}]/u;

describe("buildBookingConfirmationEmail", () => {
  const out = buildBookingConfirmationEmail({
    prospectFirstName: "Sarah",
    slotStartLocal: "Tuesday, 14 May 2026 at 2:00 PM Manila time",
    prospectTimezone: "Asia/Manila",
    durationMinutes: 30,
    meetUrl: "https://meet.google.com/abc-defg-hij",
    manageUrl: "https://archoslabs.xyz/book/manage/jwt-token-here",
    recommendedReading: [
      { title: "Why most AI programs fail", url: "https://archoslabs.xyz/blog/x" },
    ],
  });

  it("returns the {subject, text, html} contract", () => {
    expect(out.subject).toBeTypeOf("string");
    expect(out.text).toBeTypeOf("string");
    expect(out.html).toBeTypeOf("string");
  });

  it("subject contains the slot string and obeys voice rules", () => {
    expect(out.subject).toContain("Tuesday, 14 May 2026 at 2:00 PM Manila time");
    expect(out.subject).not.toMatch(SUBJECT_FORBIDDEN);
  });

  it("plain text mentions the meet url and manage url", () => {
    expect(out.text).toContain("https://meet.google.com/abc-defg-hij");
    expect(out.text).toContain("https://archoslabs.xyz/book/manage/jwt-token-here");
  });

  it("includes the recommended-reading section when present", () => {
    expect(out.text).toContain("While you wait");
    expect(out.html).toContain("Why most AI programs fail");
  });

  it("escapes a malicious prospect first name in HTML output", () => {
    const malicious = buildBookingConfirmationEmail({
      prospectFirstName: "Sarah",
      slotStartLocal: "<script>alert(1)</script>",
      prospectTimezone: "Asia/Manila",
      durationMinutes: 30,
      meetUrl: "https://meet.google.com/x",
      manageUrl: "https://archoslabs.xyz/x",
      recommendedReading: [],
    });
    expect(malicious.html).not.toContain("<script>alert(1)</script>");
    expect(malicious.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("buildBookingReminder24hEmail", () => {
  const out = buildBookingReminder24hEmail({
    prospectFirstName: "Sarah",
    slotTimeLocal: "2:00 PM Manila",
    meetUrl: "https://meet.google.com/x",
    manageUrl: "https://archoslabs.xyz/x",
  });

  it("subject leads with 'Tomorrow at' and contains the slot", () => {
    expect(out.subject).toMatch(/^Tomorrow at 2:00 PM Manila/);
  });

  it("subject is voice-clean", () => {
    expect(out.subject).not.toMatch(SUBJECT_FORBIDDEN);
  });

  it("includes Meet link and manage link in text", () => {
    expect(out.text).toContain("https://meet.google.com/x");
    expect(out.text).toContain("https://archoslabs.xyz/x");
  });
});

describe("buildBookingReminder1hEmail", () => {
  const out = buildBookingReminder1hEmail({
    prospectFirstName: "Sarah",
    meetUrl: "https://meet.google.com/x",
  });

  it("subject is exactly 'In an hour'", () => {
    expect(out.subject).toBe("In an hour");
  });

  it("html includes a CTA to the meet url", () => {
    expect(out.html).toContain('href="https://meet.google.com/x"');
  });
});

describe("buildBookingPrecallBriefEmail", () => {
  const out = buildBookingPrecallBriefEmail({
    prospectName: "Sarah Chen",
    prospectRole: "Head of Engineering",
    prospectOrganisation: "Acme Corp",
    slotTimeLocal: "2:00 PM Manila",
    priorityScore: "P1",
    priorityReason: "Decision-maker, 30-day deadline, CEO pressure",
    summaryParagraph:
      "Wants concrete advice on building internal AI capability vs partnering with a fractional. Mid-sized SaaS, ~50 engineers.",
    talkingPoints: [
      "Map their data foundation maturity first.",
      "Probe whether the CEO pressure has a real deadline or is performance theatre.",
      "Surface fractional-vs-FTE economics for their team shape.",
    ],
    intakeTranscript: [
      { question: "What's the one thing?", answer: "Decide on AI hire" },
      { question: "Is this for you or a team?", answer: "I lead a 50-eng group" },
    ],
  });

  it("subject is [ARCHOS BRIEF] prefixed and scannable", () => {
    expect(out.subject).toMatch(
      /^\[ARCHOS BRIEF\] Sarah Chen \/ Acme Corp \/ 2:00 PM Manila$/,
    );
  });

  it("plain text includes all required brief sections", () => {
    expect(out.text).toContain("PROSPECT:");
    expect(out.text).toContain("SCORE:    P1");
    expect(out.text).toContain("THE ASK:");
    expect(out.text).toContain("SUGGESTED TALKING POINTS:");
    expect(out.text).toContain("INTAKE TRANSCRIPT:");
  });

  it("strips control chars from prospect inputs", () => {
    const tainted = buildBookingPrecallBriefEmail({
      prospectName: "Sarah\x00\x07Chen",
      prospectRole: "x",
      prospectOrganisation: "y",
      slotTimeLocal: "now",
      priorityScore: "P1",
      priorityReason: "z",
      summaryParagraph: "a",
      talkingPoints: ["b"],
      intakeTranscript: [],
    });
    expect(tainted.text).not.toContain("\x00");
    expect(tainted.text).toContain("SarahChen");
  });
});

describe("buildBookingPostcallFollowupEmail", () => {
  it("subject is the stable recap phrase", () => {
    const out = buildBookingPostcallFollowupEmail({
      prospectFirstName: "Sarah",
      intakeTopic: "AI hiring decision",
      nextStepsBullets: ["Send the case study", "Schedule the deeper session"],
    });
    expect(out.subject).toBe("Today's call — quick recap");
    expect(out.text).toContain("AI hiring decision");
    expect(out.html).toContain("Send the case study");
  });

  it("renders the optional rebook CTA when present", () => {
    const withRebook = buildBookingPostcallFollowupEmail({
      prospectFirstName: "Sarah",
      intakeTopic: "x",
      nextStepsBullets: ["a"],
      rebookUrl: "https://archoslabs.xyz/book?utm=followup",
    });
    expect(withRebook.html).toContain(
      'href="https://archoslabs.xyz/book?utm=followup"',
    );
  });

  it("omits the rebook CTA when not given", () => {
    const noRebook = buildBookingPostcallFollowupEmail({
      prospectFirstName: "Sarah",
      intakeTopic: "x",
      nextStepsBullets: ["a"],
    });
    expect(noRebook.html).not.toContain("grab another time");
  });
});

describe("buildBookingNoshowRecoveryEmail", () => {
  const out = buildBookingNoshowRecoveryEmail({
    prospectFirstName: "Sarah",
    rebookUrl: "https://archoslabs.xyz/book?utm=noshow",
  });

  it("subject is the stable 'missed each other' phrase", () => {
    expect(out.subject).toBe("Looks like we missed each other");
    expect(out.subject).not.toMatch(SUBJECT_FORBIDDEN);
  });

  it("contains the rebook link in both text and html", () => {
    expect(out.text).toContain("https://archoslabs.xyz/book?utm=noshow");
    expect(out.html).toContain("https://archoslabs.xyz/book?utm=noshow");
  });
});
