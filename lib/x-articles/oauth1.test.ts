import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { oauth1Header, type XCredentials } from "./oauth1";

// Worked example from
// https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature
// (host api.x.com, expected oauth_signature Ls93hJiZbQ3akF3HF3x1Bz8/zU4=).
const DOCS_CREDS: XCredentials = {
  apiKey: "xvz1evFS4wEEPTGEFPHBog",
  apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

const CREDS: XCredentials = {
  apiKey: "key",
  apiSecret: "secret",
  accessToken: "token",
  accessTokenSecret: "token-secret",
};

// Independent of the implementation: the base string is written out by hand.
function sign(base: string) {
  return createHmac("sha1", "secret&token-secret").update(base).digest("base64");
}

describe("oauth1Header", () => {
  it("reproduces the X docs worked example (query param + form body param)", () => {
    const header = oauth1Header({
      method: "POST",
      url: "https://api.x.com/1.1/statuses/update.json?include_entities=true",
      params: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      credentials: DOCS_CREDS,
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: "1318622958",
    });
    expect(header).toBe(
      'OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", ' +
        'oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", ' +
        'oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D", ' +
        'oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", ' +
        'oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", ' +
        'oauth_version="1.0"',
    );
  });

  it("signs a JSON-body call from the oauth params alone, deterministically", () => {
    const opts = {
      method: "POST",
      url: "https://api.x.com/2/articles/draft",
      credentials: CREDS,
      nonce: "n0nce",
      timestamp: "1700000000",
    };
    const base =
      "POST&https%3A%2F%2Fapi.x.com%2F2%2Farticles%2Fdraft&" +
      encodeURIComponent(
        "oauth_consumer_key=key&oauth_nonce=n0nce&oauth_signature_method=HMAC-SHA1" +
          "&oauth_timestamp=1700000000&oauth_token=token&oauth_version=1.0",
      );
    const header = oauth1Header(opts);
    expect(header).toBe(oauth1Header(opts));
    expect(header).toContain(`oauth_signature="${encodeURIComponent(sign(base))}"`);
  });

  it("percent-encodes special characters per RFC 3986 and sorts by encoded key", () => {
    const header = oauth1Header({
      method: "post",
      url: "https://api.x.com/1.1/x.json",
      params: { "b key": "a b!'()*~é&=", a: "1" },
      credentials: CREDS,
      nonce: "n",
      timestamp: "1",
    });
    const params =
      "a=1&b%20key=a%20b%21%27%28%29%2A~%C3%A9%26%3D" +
      "&oauth_consumer_key=key&oauth_nonce=n&oauth_signature_method=HMAC-SHA1" +
      "&oauth_timestamp=1&oauth_token=token&oauth_version=1.0";
    const base = `POST&${encodeURIComponent("https://api.x.com/1.1/x.json")}&${encodeURIComponent(params)}`;
    expect(header).toContain(`oauth_signature="${encodeURIComponent(sign(base))}"`);
  });

  it("uses the injected nonce and timestamp, and random ones otherwise", () => {
    const fixed = oauth1Header({
      method: "GET",
      url: "https://api.x.com/2/users/me",
      credentials: CREDS,
      nonce: "abc",
      timestamp: "42",
    });
    expect(fixed).toContain('oauth_nonce="abc"');
    expect(fixed).toContain('oauth_timestamp="42"');

    const a = oauth1Header({ method: "GET", url: "https://api.x.com/2/users/me", credentials: CREDS });
    const b = oauth1Header({ method: "GET", url: "https://api.x.com/2/users/me", credentials: CREDS });
    expect(a).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
    expect(a).not.toBe(b);
    const ts = Number(/oauth_timestamp="(\d+)"/.exec(a)![1]);
    expect(Math.abs(ts - Date.now() / 1000)).toBeLessThan(5);
  });

  it("never puts the secrets in the header", () => {
    const header = oauth1Header({ method: "GET", url: "https://api.x.com/2/users/me", credentials: CREDS });
    expect(header).not.toContain(CREDS.apiSecret);
    expect(header).not.toContain(CREDS.accessTokenSecret);
  });
});
