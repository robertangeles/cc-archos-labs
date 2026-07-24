import { describe, expect, it } from "vitest";
import { consentDefaultSnippet, EEA_REGIONS, CONSENT_KEY } from "./consent";

// The consent-default script runs before every Google tag. If the granted/
// denied blocks, the region scoping, or the stored-choice replay break, the
// whole Consent Mode contract silently breaks.
describe("consentDefaultSnippet", () => {
  it("sets a granted global default then a denied region-scoped default", () => {
    const s = consentDefaultSnippet();
    expect(s).toContain("gtag('consent','default'");
    expect(s).toContain('"analytics_storage":"granted"');
    // both v2 signals present in the denied (region) block
    expect(s).toContain('"ad_user_data":"denied"');
    expect(s).toContain('"ad_personalization":"denied"');
    // region + wait_for_update are object-literal keys (unquoted) via Object.assign
    expect(s).toContain("wait_for_update:500");
    expect(s).toContain("region:");
  });

  it("replays a stored choice via consent update", () => {
    const s = consentDefaultSnippet();
    expect(s).toContain(`localStorage.getItem('${CONSENT_KEY}')`);
    expect(s).toContain("gtag('consent','update'");
  });
});

describe("EEA_REGIONS", () => {
  it("covers EEA + UK + Switzerland and excludes AU / US", () => {
    for (const code of ["DE", "FR", "IE", "GB", "CH", "NO", "IS"]) {
      expect(EEA_REGIONS).toContain(code);
    }
    expect(EEA_REGIONS).not.toContain("AU");
    expect(EEA_REGIONS).not.toContain("US");
  });
});
