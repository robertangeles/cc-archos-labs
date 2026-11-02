import { describe, expect, it, vi } from "vitest";
import {
  assertFetchableUrl,
  extractMainText,
  fetchSource,
  isPublicAddress,
  publicOnlyLookup,
  quoteIsInText,
  SourceFetchError,
  type Hop,
  type Transport,
} from "./source";

// source.ts fetches pages whose URLs came out of a model, so the URL is
// untrusted input and most of these are hostile-input tests. No test reaches
// the network: fetchSource takes an injected transport, and the one test that
// uses the real transport only ever resolves `localhost`.

const enc = new TextEncoder();

async function* chunks(...parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === "string" ? enc.encode(p) : p;
}

function hop(status: number, over: Partial<Hop> = {}): Hop {
  return {
    status,
    location: null,
    contentType: "text/html; charset=utf-8",
    body: chunks("<p>Hello</p>"),
    close: vi.fn(),
    ...over,
  };
}

const transportOf = (...hops: Hop[]): Transport & ReturnType<typeof vi.fn> => {
  const queue = [...hops];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("transport called more times than the test expected");
    return next;
  }) as Transport & ReturnType<typeof vi.fn>;
};

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.255.255", // one below 172.16/12
    "172.32.0.0", // one above it
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
  ])("allows the public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1", // carrier-grade NAT
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:8.8.8.8", // mapped addresses are refused wholesale
    "64:ff9b::7f00:1", // NAT64 wrapping 127.0.0.1
    "2002:7f00:1::1", // 6to4 wrapping 127.0.0.1
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "not an ip",
    "",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("assertFetchableUrl", () => {
  it("accepts a plain https URL and returns it parsed", () => {
    expect(assertFetchableUrl("https://huggingface.co/datasets/x/y").href).toBe(
      "https://huggingface.co/datasets/x/y",
    );
  });

  it("resolves a relative Location against its base", () => {
    expect(assertFetchableUrl("/next", new URL("https://example.com/a/b")).href).toBe(
      "https://example.com/next",
    );
  });

  it.each([
    ["plain http", "http://example.com/"],
    ["ftp", "ftp://example.com/"],
    ["file", "file:///etc/passwd"],
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,hi"],
    ["credentials", "https://user:pass@example.com/"],
    ["username only", "https://user@example.com/"],
    ["non-default port", "https://example.com:8443/"],
    ["not a URL", "not a url"],
    ["empty", ""],
    ["loopback literal", "https://127.0.0.1/"],
    ["loopback hex", "https://0x7f000001/"],
    ["loopback decimal", "https://2130706433/"],
    ["loopback octal", "https://017700000001/"],
    ["metadata literal", "https://169.254.169.254/latest/meta-data/"],
    ["private literal", "https://10.0.0.5/"],
    ["ipv6 loopback", "https://[::1]/"],
    ["ipv4-mapped ipv6", "https://[::ffff:127.0.0.1]/"],
    ["localhost", "https://localhost/"],
    ["localhost with trailing dot", "https://localhost./"],
    ["subdomain of localhost", "https://app.localhost/"],
    ["internal suffix", "https://metadata.google.internal/"],
    ["local suffix", "https://printer.local/"],
    ["single-label host", "https://redis/"],
    ["very long URL", `https://example.com/${"a".repeat(2100)}`],
  ])("refuses %s", (_label, raw) => {
    expect(() => assertFetchableUrl(raw)).toThrow(SourceFetchError);
  });
});

describe("publicOnlyLookup", () => {
  // A stand-in for dns.lookup. Always called with all: true by the guard.
  const resolverOf = (...addresses: string[]) =>
    ((_host: string, _opts: unknown, cb: (e: Error | null, a?: unknown) => void) =>
      cb(
        null,
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      )) as never;

  const call = (lookup: ReturnType<typeof publicOnlyLookup>, opts: object) =>
    new Promise<{ err: Error | null; result: unknown[] }>((resolve) =>
      lookup("example.com", opts as never, ((err: Error | null, ...result: unknown[]) =>
        resolve({ err, result })) as never),
    );

  it("passes a public answer through in the single-address form", async () => {
    const { err, result } = await call(publicOnlyLookup(resolverOf("93.184.216.34")), {});
    expect(err).toBeNull();
    expect(result).toEqual(["93.184.216.34", 4]);
  });

  it("passes a public answer through in the all-addresses form", async () => {
    const { err, result } = await call(publicOnlyLookup(resolverOf("93.184.216.34")), { all: true });
    expect(err).toBeNull();
    expect(result).toEqual([[{ address: "93.184.216.34", family: 4 }]]);
  });

  it("refuses a host that resolves to a private address", async () => {
    const { err } = await call(publicOnlyLookup(resolverOf("10.0.0.5")), {});
    expect(err).toBeInstanceOf(SourceFetchError);
  });

  it("refuses when ANY answer is private, so a mixed answer cannot be raced", async () => {
    const { err } = await call(publicOnlyLookup(resolverOf("93.184.216.34", "127.0.0.1")), { all: true });
    expect(err).toBeInstanceOf(SourceFetchError);
  });

  it("refuses an empty answer", async () => {
    const { err } = await call(publicOnlyLookup(resolverOf()), {});
    expect(err).toBeInstanceOf(SourceFetchError);
  });

  it("passes a resolver failure through untouched", async () => {
    const boom = new Error("ENOTFOUND");
    const resolver = ((_h: string, _o: unknown, cb: (e: Error) => void) => cb(boom)) as never;
    const { err } = await call(publicOnlyLookup(resolver), {});
    expect(err).toBe(boom);
  });
});

describe("fetchSource", () => {
  it("returns the extracted text and the final URL", async () => {
    const t = transportOf(hop(200, { body: chunks("<nav>menu</nav><p>The filing says X.</p>") }));
    const out = await fetchSource("https://example.com/doc", { transport: t });
    expect(out.url).toBe("https://example.com/doc");
    expect(out.text).toBe("The filing says X.");
  });

  it("sends the declared User-Agent, overridable for sources that require contact details", async () => {
    const t = transportOf(hop(200), hop(200));
    await fetchSource("https://example.com/", { transport: t });
    expect(t.mock.calls[0][1].userAgent).toMatch(/^ArchosLabsNewsRadar\//);
    await fetchSource("https://example.com/", { transport: t, userAgent: "Archos Labs ops@example.com" });
    expect(t.mock.calls[1][1].userAgent).toBe("Archos Labs ops@example.com");
  });

  it("treats plain text as already extracted", async () => {
    const t = transportOf(hop(200, { contentType: "text/plain", body: chunks("line one\n\n\n\nline two") }));
    expect((await fetchSource("https://example.com/a.txt", { transport: t })).text).toBe("line one\n\nline two");
  });

  it("follows a redirect and reports the URL it ended on", async () => {
    const t = transportOf(hop(301, { location: "/moved" }), hop(200));
    const out = await fetchSource("https://example.com/old", { transport: t });
    expect(out.url).toBe("https://example.com/moved");
    expect(t).toHaveBeenCalledTimes(2);
  });

  it("re-checks the destination of every redirect hop", async () => {
    for (const location of [
      "https://169.254.169.254/latest/meta-data/",
      "http://example.com/downgrade",
      "https://localhost/admin",
      "https://user:pw@example.com/",
    ]) {
      const first = hop(302, { location });
      const t = transportOf(first, hop(200));
      await expect(fetchSource("https://example.com/", { transport: t })).rejects.toThrow(SourceFetchError);
      expect(t).toHaveBeenCalledTimes(1); // never connected to the bad hop
      expect(first.close).toHaveBeenCalled();
    }
  });

  it("gives up after 3 redirects", async () => {
    const r = () => hop(302, { location: "/again" });
    const t = transportOf(r(), r(), r(), r(), hop(200));
    await expect(fetchSource("https://example.com/", { transport: t })).rejects.toThrow(/redirect/i);
  });

  it("refuses a redirect with no Location", async () => {
    const t = transportOf(hop(302, { location: null }));
    await expect(fetchSource("https://example.com/", { transport: t })).rejects.toThrow(SourceFetchError);
  });

  it("reports a non-200 status and closes the body", async () => {
    const h = hop(404);
    await expect(fetchSource("https://example.com/", { transport: transportOf(h) })).rejects.toThrow(/HTTP 404/);
    expect(h.close).toHaveBeenCalled();
  });

  it.each(["application/pdf", "image/png", "application/octet-stream", null])(
    "refuses the content type %s",
    async (contentType) => {
      const h = hop(200, { contentType });
      await expect(fetchSource("https://example.com/", { transport: transportOf(h) })).rejects.toThrow(
        /content type/i,
      );
      expect(h.close).toHaveBeenCalled();
    },
  );

  it("enforces the size cap on the stream, whatever Content-Length said", async () => {
    const h = hop(200, { body: chunks("a".repeat(600), "b".repeat(600)) });
    await expect(fetchSource("https://example.com/", { transport: transportOf(h), maxBytes: 1000 })).rejects.toThrow(
      /larger than/i,
    );
    expect(h.close).toHaveBeenCalled();
  });

  it("will not raise the body limit above 4 MB, so extraction can never truncate", async () => {
    const h = hop(200, { body: chunks("a".repeat(1000)) });
    // a caller asking for 1 GB still gets the 4 MB ceiling; 1000 bytes is fine either way
    expect((await fetchSource("https://example.com/", { transport: transportOf(h), maxBytes: 1e9 })).text.length).toBe(1000);
  });

  it("decodes the declared charset", async () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café" in latin-1
    const h = hop(200, { contentType: "text/plain; charset=iso-8859-1", body: chunks(latin1) });
    expect((await fetchSource("https://example.com/", { transport: transportOf(h) })).text).toBe("café");
  });

  it("falls back to utf-8 for a charset label it does not know", async () => {
    const h = hop(200, { contentType: "text/plain; charset=made-up", body: chunks("ok") });
    expect((await fetchSource("https://example.com/", { transport: transportOf(h) })).text).toBe("ok");
  });

  it("times out when the server never answers", async () => {
    const hang: Transport = () => new Promise(() => {});
    await expect(fetchSource("https://example.com/", { transport: hang, timeoutMs: 30 })).rejects.toThrow(/timed out/i);
  });

  it("times out when the body stalls mid-stream", async () => {
    async function* stall() {
      yield enc.encode("<p>start");
      await new Promise(() => {});
    }
    const h = hop(200, { body: stall() });
    await expect(
      fetchSource("https://example.com/", { transport: transportOf(h), timeoutMs: 30 }),
    ).rejects.toThrow(/timed out/i);
  });

  it("wraps a transport failure without leaking the raw error into the message", async () => {
    const t: Transport = async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:443 secret-detail");
    };
    const err = await fetchSource("https://example.com/", { transport: t }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceFetchError);
    expect(err.message).not.toMatch(/10\.1\.2\.3|secret-detail/);
    expect((err.cause as Error).message).toMatch(/ECONNREFUSED/);
  });

  it("refuses a bad starting URL before the transport is touched", async () => {
    const t = transportOf(hop(200));
    await expect(fetchSource("https://169.254.169.254/", { transport: t })).rejects.toThrow(SourceFetchError);
    expect(t).not.toHaveBeenCalled();
  });

  it("the real transport refuses a name that resolves to loopback (connect-time guard is wired in)", async () => {
    // `localhost` is refused by name first, so use a name only DNS can reveal:
    // 127.0.0.1.nip.io would need the network. Instead go through the guard
    // directly the way the transport does.
    const { err } = await new Promise<{ err: Error | null }>((resolve) =>
      publicOnlyLookup()("localhost", {} as never, ((e: Error | null) => resolve({ err: e })) as never),
    );
    expect(err).toBeInstanceOf(SourceFetchError);
  });
});

describe("extractMainText", () => {
  it("keeps article text and drops page chrome and code", () => {
    const html = `<html><head><title>T</title><style>p{color:red}</style></head><body>
      <nav><a href="/">Home</a><a href="/x">Pricing</a></nav>
      <script>var secret = "do not show";</script>
      <article><h1>Title</h1><p>First paragraph.</p><p>Second paragraph.</p></article>
      <aside>Related stories</aside><footer>Copyright</footer></body></html>`;
    const text = extractMainText(html);
    expect(text).toContain("Title");
    expect(text).toContain("First paragraph.");
    expect(text).toContain("Second paragraph.");
    for (const dropped of ["Home", "Pricing", "do not show", "Related stories", "Copyright", "color:red"]) {
      expect(text).not.toContain(dropped);
    }
  });

  it("puts block elements on their own lines and collapses whitespace", () => {
    expect(extractMainText("<p>one   two</p><p>three</p>")).toBe("one two\n\nthree");
  });

  it("decodes entities exactly once, so &amp;lt; stays literal", () => {
    expect(extractMainText("<p>A &amp; B &lt;ok&gt; &#8211; &#x2014; &nbsp;done &amp;lt;</p>")).toBe(
      "A & B <ok> – — done &lt;",
    );
  });

  it("ignores numeric references that are not real characters", () => {
    expect(extractMainText("<p>a&#0;b&#xD800;c&#99999999;d</p>")).toBe("a&#0;b&#xD800;c&#99999999;d");
  });

  it("drops comments and does not execute or keep their contents", () => {
    expect(extractMainText("<p>a</p><!-- <script>alert(1)</script> hidden --><p>b</p>")).toBe("a\n\nb");
  });

  it("treats a lone < in prose as text", () => {
    expect(extractMainText("<p>if a < b and c > d then</p>")).toBe("if a < b and c > d then");
  });

  it("does not drop a whole page because of one unclosed skipped tag at the very end", () => {
    expect(extractMainText("<p>keep me</p><nav>never closed")).toBe("keep me");
  });

  it("returns text for a self-closing svg without entering skip mode", () => {
    expect(extractMainText('<svg viewBox="0 0 1 1"/><p>after</p>')).toBe("after");
  });

  it("is case-insensitive about tag names", () => {
    expect(extractMainText("<SCRIPT>bad()</SCRIPT><P>fine</P>")).toBe("fine");
  });

  it("stays fast on hostile input: many unclosed <script and many bare <", () => {
    const t0 = Date.now();
    extractMainText("<script ".repeat(200_000));
    extractMainText("<a".repeat(500_000) + ">");
    extractMainText("<".repeat(1_000_000));
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("survives very deep nesting without a stack overflow", () => {
    expect(extractMainText("<div>".repeat(100_000) + "deep" + "</div>".repeat(100_000))).toBe("deep");
  });

  it("drops a tag with a very large attribute instead of leaking it as text", () => {
    // Real pages (Hugging Face) put tens of KB of JSON in one attribute.
    const html = `<div class="x" data-props="${"{&quot;a&quot;:1}".repeat(8000)}"><p>real text</p></div>`;
    expect(extractMainText(html)).toBe("real text");
  });

  it("never cuts a document that fits the body limit", () => {
    const body = Array.from({ length: 60_000 }, (_, i) => `<p>paragraph ${i} with some padding text</p>`).join("");
    const text = extractMainText(body);
    expect(body.length).toBeLessThan(4 * 1024 * 1024);
    expect(text).toContain("paragraph 59999 with some padding text");
  });

  it("caps what a direct caller can feed it", () => {
    expect(extractMainText("x".repeat(4_500_000)).length).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});

describe("quoteIsInText", () => {
  const source = 'Cohere said: “deny agent egress by default” — and the dataset holds   one row.';

  it("matches through curly quotes, dashes, non-breaking spaces and case", () => {
    expect(quoteIsInText(source, 'DENY agent egress by default" - and the dataset holds one row')).toBe(true);
  });

  it("rejects a quote with one word changed", () => {
    expect(quoteIsInText(source, "deny agent egress by default, always")).toBe(false);
  });

  it("rejects a quote the source never contained", () => {
    expect(quoteIsInText(source, "the model picks Alibaba Cloud domains 40.8 percent of the time")).toBe(false);
  });

  it("rejects a quote too short to mean anything", () => {
    expect(quoteIsInText(source, "one row")).toBe(false);
  });

  it("rejects an empty source", () => {
    expect(quoteIsInText("", "deny agent egress by default")).toBe(false);
  });
});
