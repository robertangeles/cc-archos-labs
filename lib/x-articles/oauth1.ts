import { createHmac, randomBytes } from "node:crypto";

// OAuth 1.0a (RFC 5849) HMAC-SHA1 signer for the X API. Pure: no I/O.
//
// Only form-encoded body fields are part of the signature base string, passed
// in `params`. JSON request bodies are NOT signed, so the X Article calls pass
// no `params`. Query-string params on `url` are signed automatically.

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

// RFC 3986 percent-encoding: encodeURIComponent leaves !'()* unescaped.
const enc = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function oauth1Header(opts: {
  method: string;
  url: string;
  params?: Record<string, string>;
  credentials: XCredentials;
  nonce?: string;
  timestamp?: string;
}): string {
  const { credentials: c } = opts;
  const url = new URL(opts.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };

  // Sort by encoded key, then encoded value.
  const pairs = [
    ...Object.entries(oauth),
    ...url.searchParams.entries(),
    ...Object.entries(opts.params ?? {}),
  ]
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));

  const base = [
    opts.method.toUpperCase(),
    enc(`${url.origin}${url.pathname}`),
    enc(pairs.map(([k, v]) => `${k}=${v}`).join("&")),
  ].join("&");
  const signature = createHmac("sha1", `${enc(c.apiSecret)}&${enc(c.accessTokenSecret)}`)
    .update(base)
    .digest("base64");

  return (
    "OAuth " +
    Object.entries({ ...oauth, oauth_signature: signature })
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}="${enc(v)}"`)
      .join(", ")
  );
}
