import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  gtmSnippet,
  GoogleTagManagerNoScript,
} from "./google-tag-manager";

// A wrong container id (or a broken snippet) silently sends every page's
// data to the wrong GTM container — or nowhere. These pin the two places the
// id is interpolated: the loader snippet and the <noscript> iframe.
describe("gtmSnippet", () => {
  it("interpolates the container id into the loader", () => {
    const s = gtmSnippet("GTM-TDT86Q37");
    expect(s).toContain("'GTM-TDT86Q37'");
    expect(s).toContain("googletagmanager.com/gtm.js?id=");
    expect(s).toContain("dataLayer");
  });
});

describe("GoogleTagManagerNoScript", () => {
  it("renders the ns.html iframe with the container id when set", () => {
    const html = renderToString(
      <GoogleTagManagerNoScript gtmId="GTM-TDT86Q37" />,
    );
    expect(html).toContain(
      "https://www.googletagmanager.com/ns.html?id=GTM-TDT86Q37",
    );
    expect(html).toContain("<noscript>");
  });

  it("renders nothing when the id is unset (dev / preview no-op)", () => {
    expect(renderToString(<GoogleTagManagerNoScript />)).toBe("");
    expect(renderToString(<GoogleTagManagerNoScript gtmId="" />)).toBe("");
  });

  it("renders nothing when the id does not match GTM-[A-Z0-9]+ (misconfigured env)", () => {
    // Malformed ids must not reach the src interpolation.
    expect(renderToString(<GoogleTagManagerNoScript gtmId="INVALID" />)).toBe("");
    expect(
      renderToString(<GoogleTagManagerNoScript gtmId="'); alert(1)//" />),
    ).toBe("");
  });
});
