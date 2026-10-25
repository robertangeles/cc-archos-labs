import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEED_URL,
  FeedFetchError,
  FeedParseError,
  fetchFeed,
  parseAtom,
} from "./feed";

// feed.ts reads a feed we do not control, so most of these are hostile-input
// tests. No test touches the network: fetchFeed takes an injected fetch.

interface EntryParts {
  title?: string | null;
  link?: string | null;
  id?: string | null;
  published?: string | null;
  updated?: string | null;
  summary?: string | null;
  category?: string | null;
}

// null means "leave this element out"; omitted means "use a good default".
function entry(p: EntryParts = {}): string {
  const title = p.title === undefined ? "A headline" : p.title;
  const link =
    p.link === undefined ? "https://huggingnews.com/ai/a-headline-1" : p.link;
  const published =
    p.published === undefined ? "2026-10-25T19:53:04.488Z" : p.published;
  const summary = p.summary === undefined ? "Some summary." : p.summary;
  return (
    "<entry>" +
    (p.id ? `<id>${p.id}</id>` : "") +
    (title === null ? "" : `<title>${title}</title>`) +
    (link === null ? "" : `<link rel="alternate" type="text/html" href="${link}"/>`) +
    (p.category == null ? "" : `<category term="${p.category}"/>`) +
    (published === null ? "" : `<published>${published}</published>`) +
    (p.updated == null ? "" : `<updated>${p.updated}</updated>`) +
    (summary === null ? "" : `<summary type="text">${summary}</summary>`) +
    "</entry>"
  );
}

function feed(...entries: string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<feed xmlns="http://www.w3.org/2005/Atom"><id>https://huggingnews.com</id>' +
    "<title>HuggingNews</title><updated>2026-10-25T19:53:04.488Z</updated>" +
    entries.join("") +
    "</feed>"
  );
}

describe("parseAtom: shape", () => {
  it("returns zero entries for a feed with no entries (valid, not an error)", () => {
    expect(parseAtom(feed())).toEqual({ entries: [], skipped: 0 });
  });

  it("parses a trimmed copy of the live feed's structure", () => {
    // Same shape as the real feed: Atom namespace, self/alternate/hub links at
    // feed level, a category term per entry, paragraph breaks and &apos; in
    // type="text" summaries. Headlines are invented.
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">' +
      "<id>https://huggingnews.com</id><title>HuggingNews</title>" +
      "<subtitle>Realtime AI news story feed grouped by day.</subtitle>" +
      "<updated>2026-10-25T19:53:04.488Z</updated><author><name>HuggingNews</name></author>" +
      '<link rel="self" type="application/atom+xml" href="https://huggingnews.com/feed.xml"/>' +
      '<link rel="alternate" type="text/html" href="https://huggingnews.com"/>' +
      '<link rel="hub" href="https://pubsubhubbub.appspot.com/"/>' +
      "<entry><id>https://huggingnews.com/ai/first-story-3ece57a5</id>" +
      "<title>First Story Closes $40B Raise</title>" +
      '<link rel="alternate" type="text/html" href="https://huggingnews.com/ai/first-story-3ece57a5"/>' +
      '<category term="ai"/><published>2026-10-25T19:53:04.488Z</published>' +
      '<updated>2026-10-25T19:53:04.488Z</updated><summary type="text">The company&apos;s raise closed.\n\nPricing sits near 8.3%.</summary></entry>' +
      "<entry><id>https://huggingnews.com/world/second-story-7a69b364</id>" +
      "<title>Second Story &amp; Friends</title>" +
      '<link rel="alternate" type="text/html" href="https://huggingnews.com/world/second-story-7a69b364"/>' +
      '<category term="world"/><published>2026-10-25T18:08:04.867Z</published>' +
      '<updated>2026-10-25T18:08:04.867Z</updated><summary type="text">A &quot;quoted&quot; line.</summary></entry>' +
      "</feed>";
    expect(parseAtom(xml)).toEqual({
      skipped: 0,
      entries: [
        {
          sourceUrl: "https://huggingnews.com/ai/first-story-3ece57a5",
          title: "First Story Closes $40B Raise",
          summary: "The company's raise closed.\n\nPricing sits near 8.3%.",
          category: "ai",
          publishedAt: new Date("2026-10-25T19:53:04.488Z"),
        },
        {
          sourceUrl: "https://huggingnews.com/world/second-story-7a69b364",
          title: "Second Story & Friends",
          summary: 'A "quoted" line.',
          category: "world",
          publishedAt: new Date("2026-10-25T18:08:04.867Z"),
        },
      ],
    });
  });

  it("keeps feed order and ignores feed-level title and links", () => {
    const { entries } = parseAtom(
      feed(
        entry({ title: "one", link: "https://huggingnews.com/1" }),
        entry({ title: "two", link: "https://huggingnews.com/2" }),
      ),
    );
    expect(entries.map((e) => e.title)).toEqual(["one", "two"]);
  });

  it("defaults summary to '' and category to null, and uses <content> when there is no <summary>", () => {
    const [bare] = parseAtom(feed(entry({ summary: null }))).entries;
    expect(bare.summary).toBe("");
    expect(bare.category).toBeNull();

    const xml = feed(
      "<entry><title>t</title>" +
        '<link href="https://huggingnews.com/x"/>' +
        "<published>2026-10-25T00:00:00Z</published>" +
        '<content type="text">from content</content></entry>',
    );
    expect(parseAtom(xml).entries[0].summary).toBe("from content");
  });
});

describe("parseAtom: rejects documents that are not a complete Atom feed", () => {
  const good = feed(entry());
  const cases: [string, string][] = [
    ["empty string", ""],
    ["plain text", "not xml at all"],
    ["truncated mid-entry", good.slice(0, good.indexOf("<summary") + 12)],
    ["truncated before </feed>", good.replace("</feed>", "")],
    ["HTML error page", "<html><body>502 Bad Gateway</body></html>"],
    ["RSS root, no <feed>", '<rss version="2.0"><channel></channel></rss>'],
    ["text before the root", "oops" + good],
  ];
  it.each(cases)("%s -> FeedParseError", (_name, xml) => {
    expect(() => parseAtom(xml)).toThrow(FeedParseError);
  });

  it("accepts a leading BOM and comments before the root", () => {
    expect(parseAtom("\uFEFF<!-- hi -->\n" + good).entries).toHaveLength(1);
  });

  it("is not fooled by a comment that holds a fake </entry> or <entry>", () => {
    const xml = feed(
      entry({ title: "real" }).replace(
        "<summary",
        "<!-- </entry><entry><title>fake</title> --><summary",
      ),
    );
    const { entries } = parseAtom(xml);
    expect(entries.map((e) => e.title)).toEqual(["real"]);
  });
});

describe("parseAtom: DOCTYPE and ENTITY are refused before anything is read", () => {
  const cases: [string, string][] = [
    [
      "DOCTYPE with internal subset (billion laughs shape)",
      '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>' +
        feed(entry({ title: "&b;" })),
    ],
    ["bare DOCTYPE", "<!DOCTYPE feed>" + feed(entry())],
    ["lowercase doctype", "<!doctype feed>" + feed(entry())],
    ["external entity (XXE shape)", '<!ENTITY xxe SYSTEM "file:///etc/passwd">' + feed(entry())],
    ["ENTITY declared mid-document", feed(entry()).replace("<entry>", '<!ENTITY a "b"><entry>')],
  ];
  it.each(cases)("%s -> FeedParseError", (_name, xml) => {
    expect(() => parseAtom(xml)).toThrow(FeedParseError);
  });
});

describe("parseAtom: CDATA", () => {
  it("takes CDATA title and summary literally", () => {
    const { entries } = parseAtom(
      feed(
        entry({
          title: "<![CDATA[Fish & <Chips> weekly]]>",
          summary: "<![CDATA[Line one & <b>two</b>\n\nLine three]]>",
        }),
      ),
    );
    expect(entries[0].title).toBe("Fish & <Chips> weekly");
    expect(entries[0].summary).toBe("Line one & <b>two</b>\n\nLine three");
  });

  it("does not decode entities inside CDATA, and does not double-decode outside it", () => {
    const { entries } = parseAtom(
      feed(
        entry({ title: "<![CDATA[a &amp; b]]>", summary: "&amp;lt; and &amp;amp;" }),
      ),
    );
    expect(entries[0].title).toBe("a &amp; b");
    expect(entries[0].summary).toBe("&lt; and &amp;");
  });

  it("mixes CDATA and plain text in one field", () => {
    const { entries } = parseAtom(
      feed(entry({ title: "Rock &amp; <![CDATA[Roll <3]]> forever" })),
    );
    expect(entries[0].title).toBe("Rock & Roll <3 forever");
  });

  it("a CDATA body holding </entry> or </feed> cannot cut the entry short", () => {
    const { entries, skipped } = parseAtom(
      feed(
        entry({ summary: "<![CDATA[evil </summary></entry></feed> end]]>" }),
        entry({ title: "second", link: "https://huggingnews.com/2" }),
      ),
    );
    expect(skipped).toBe(0);
    expect(entries.map((e) => e.title)).toEqual(["A headline", "second"]);
    expect(entries[0].summary).toBe("evil </summary></entry></feed> end");
  });
});

describe("parseAtom: entity and numeric reference decoding", () => {
  it("decodes the five predefined entities and decimal and hex references", () => {
    const { entries } = parseAtom(
      feed(
        entry({
          title: "&amp; &lt; &gt; &quot; &apos; &#65;&#x42;&#X43; &#128512;",
        }),
      ),
    );
    expect(entries[0].title).toBe(`& < > " ' ABC \u{1F600}`);
  });

  it("drops references that are not valid characters, and leaves unknown entities as text", () => {
    const { entries } = parseAtom(
      feed(
        entry({
          title: "a&#0;b&#xD800;c&#1114112;d&#x110000;e &nbsp; &foo; & bare",
        }),
      ),
    );
    expect(entries[0].title).toBe("abcde &nbsp; &foo; & bare");
  });

  it("a numeric-reference flood stays under the field cap and finishes fast", () => {
    // 200k x "&#65;" is 1 MB, the largest body fetchFeed will hand over.
    const flood = "&#65;".repeat(200_000);
    const started = Date.now();
    const { entries } = parseAtom(
      feed(entry({ title: flood, summary: flood, category: flood })),
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(entries[0].title).toBe("A".repeat(500));
    expect(entries[0].summary).toBe("A".repeat(4000));
    expect(entries[0].category).toBe("A".repeat(100));
  });

  it("caps long plain fields too, without splitting an emoji", () => {
    const { entries } = parseAtom(
      feed(entry({ title: "x".repeat(499) + "\u{1F600}" + "y".repeat(50) })),
    );
    expect(entries[0].title).toBe("x".repeat(499));
  });
});

describe("parseAtom: plain-text normalisation", () => {
  it("strips control characters and bidi overrides, normalises to NFC, trims and collapses a title", () => {
    const { entries } = parseAtom(
      feed(
        entry({
          title: "  \u0001Cafe\u0301\u0000 \u202Eevil\u202C\n\t  title  ",
          category: " \tAI \n",
        }),
      ),
    );
    expect(entries[0].title).toBe("Caf\u00E9 evil title");
    expect(entries[0].category).toBe("AI");
  });

  it("keeps paragraph breaks in a summary but collapses the rest", () => {
    const { entries } = parseAtom(
      feed(
        entry({
          summary: "\n  One\tspaced   line \r\n\r\n\r\n\r\nTwo\u0007 \n  three  \n",
        }),
      ),
    );
    expect(entries[0].summary).toBe("One spaced line\n\nTwo\nthree");
  });

  it("leaves script markup as inert plain text, never as an element", () => {
    const escaped = parseAtom(
      feed(entry({ title: "&lt;script&gt;alert(1)&lt;/script&gt; Hi" })),
    ).entries[0];
    const cdata = parseAtom(
      feed(
        entry({
          title: "<![CDATA[<script>alert(1)</script> Hi]]>",
          summary: '<![CDATA[<img src=x onerror="alert(1)">]]>',
        }),
      ),
    ).entries[0];
    expect(escaped.title).toBe("<script>alert(1)</script> Hi");
    expect(cdata.title).toBe("<script>alert(1)</script> Hi");
    expect(cdata.summary).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("parseAtom: category", () => {
  const cases: [string, string, string | null][] = [
    ["double quoted term", '<category term="ai"/>', "ai"],
    ["single quoted term", "<category term='us-markets'/>", "us-markets"],
    ["first of several", '<category term="a"/><category term="b"/>', "a"],
    ["empty term", '<category term=""/>', null],
    ["no term attribute", '<category label="x"/>', null],
    ["no category", "", null],
  ];
  it.each(cases)("%s", (_name, tag, expected) => {
    const xml = feed(
      `<entry><title>t</title><link href="https://huggingnews.com/x"/>${tag}` +
        "<published>2026-10-25T00:00:00Z</published></entry>",
    );
    expect(parseAtom(xml).entries[0].category).toBe(expected);
  });
});

describe("parseAtom: entries that cannot be used are skipped and counted, never thrown", () => {
  const cases: [string, string][] = [
    ["no link and no id", entry({ link: null })],
    ["no title", entry({ title: null })],
    ["whitespace-only title", entry({ title: " \n\t " })],
    ["empty CDATA title", entry({ title: "<![CDATA[]]>" })],
    ["http link", entry({ link: "http://huggingnews.com/x" })],
    ["javascript: link", entry({ link: "javascript:alert(1)" })],
    ["relative link", entry({ link: "/ai/story" })],
    ["link with embedded credentials", entry({ link: "https://huggingnews.com@evil.example/x" })],
    ["link over the length cap", entry({ link: "https://huggingnews.com/" + "a".repeat(2100) })],
    ["id on another host as the only link", entry({ link: null, id: "https://evil.example/x" })],
    ["id that is http as the only link", entry({ link: null, id: "http://huggingnews.com/x" })],
    ["no date at all", entry({ published: null })],
    ["unparseable published", entry({ published: "yesterday" })],
    ["date with no time", entry({ published: "2026-10-25" })],
    ["impossible calendar date", entry({ published: "2026-02-30T10:00:00Z" })],
    ["hour 25", entry({ published: "2026-10-25T25:00:00Z" })],
    ["both dates bad", entry({ published: "nope", updated: "also nope" })],
  ];
  it.each(cases)("%s", (_name, xml) => {
    expect(parseAtom(feed(xml))).toEqual({ entries: [], skipped: 1 });
  });

  it("returns the good entries and counts the bad ones", () => {
    const result = parseAtom(
      feed(
        entry({ title: "ok one", link: "https://huggingnews.com/1" }),
        entry({ link: null }),
        entry({ title: null }),
        entry({ published: "garbage" }),
        entry({ title: "ok two", link: "https://huggingnews.com/2" }),
      ),
    );
    expect(result.entries.map((e) => e.title)).toEqual(["ok one", "ok two"]);
    expect(result.skipped).toBe(3);
  });

  it("entries with nothing in them are skipped, not a crash", () => {
    expect(parseAtom(feed("<entry></entry>", "<entry/>", "<entry />"))).toEqual({
      entries: [],
      skipped: 3,
    });
  });
});

describe("parseAtom: link and date fallbacks", () => {
  it("falls back to <id> only when it is an https URL on the feed host", () => {
    const { entries } = parseAtom(
      feed(entry({ link: null, id: "https://huggingnews.com/ai/from-id" })),
    );
    expect(entries[0].sourceUrl).toBe("https://huggingnews.com/ai/from-id");
  });

  it("ignores self, hub and enclosure links, and treats a link with no rel as alternate", () => {
    const xml = feed(
      "<entry><title>t</title>" +
        '<link rel="self" href="https://huggingnews.com/self"/>' +
        '<link rel="enclosure" href="https://huggingnews.com/file.mp3"/>' +
        '<link href="https://huggingnews.com/plain"/>' +
        "<published>2026-10-25T00:00:00Z</published></entry>",
    );
    expect(parseAtom(xml).entries[0].sourceUrl).toBe("https://huggingnews.com/plain");
  });

  it("decodes entities in the link href", () => {
    const { entries } = parseAtom(
      feed(entry({ link: "https://huggingnews.com/s?a=1&amp;b=2" })),
    );
    expect(entries[0].sourceUrl).toBe("https://huggingnews.com/s?a=1&b=2");
  });

  it("uses <updated> when <published> is missing or invalid", () => {
    const missing = parseAtom(
      feed(entry({ published: null, updated: "2026-10-24T01:02:03Z" })),
    ).entries[0];
    const invalid = parseAtom(
      feed(entry({ published: "garbage", updated: "2026-10-24T01:02:03+11:00" })),
    ).entries[0];
    expect(missing.publishedAt).toEqual(new Date("2026-10-24T01:02:03Z"));
    expect(invalid.publishedAt).toEqual(new Date("2026-10-23T14:02:03Z"));
  });
});

// ---------------------------------------------------------------------------
// fetchFeed
// ---------------------------------------------------------------------------

const GOOD_XML = feed(entry({ title: "from the wire" }));

function xmlResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

// Always hands back a fresh Response: a body can only be read once.
function fetchReturning(make: () => Response) {
  return vi.fn<typeof fetch>(async () => make());
}

function redirect(to: string, status = 301): Response {
  return new Response(null, { status, headers: { location: to } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFeed: happy path", () => {
  it("fetches FEED_URL with manual redirects, a signal and a descriptive User-Agent, then parses", async () => {
    const fetchImpl = fetchReturning(() => xmlResponse(GOOD_XML));
    const result = await fetchFeed({ fetchImpl });

    expect(result.entries.map((e) => e.title)).toEqual(["from the wire"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(FEED_URL);
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("user-agent")).toBe(
      "ArchosLabsNewsRadar/0.1 (+https://archoslabs.xyz)",
    );
  });

  it("returns an empty feed without throwing", async () => {
    const result = await fetchFeed({ fetchImpl: fetchReturning(() => xmlResponse(feed())) });
    expect(result).toEqual({ entries: [], skipped: 0 });
  });

  it("a multi-byte character split across stream chunks still decodes", async () => {
    const bytes = new TextEncoder().encode(feed(entry({ title: "caf\u00E9 \u{1F600}" })));
    const at = bytes.indexOf(0xc3) + 1; // between the two bytes of the e-acute
    const fetchImpl = fetchReturning(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(bytes.slice(0, at));
              c.enqueue(bytes.slice(at));
              c.close();
            },
          }),
        ),
    );
    expect((await fetchFeed({ fetchImpl })).entries[0].title).toBe("caf\u00E9 \u{1F600}");
  });
});

describe("fetchFeed: refuses urls that are not the pinned https host, without calling fetch", () => {
  const cases: [string, string][] = [
    ["http", "http://huggingnews.com/feed.xml"],
    ["another host", "https://example.com/feed.xml"],
    ["lookalike subdomain suffix", "https://huggingnews.com.evil.example/feed.xml"],
    ["subdomain of the host", "https://www.huggingnews.com/feed.xml"],
    ["credentials", "https://huggingnews.com@evil.example/feed.xml"],
    ["other port", "https://huggingnews.com:8443/feed.xml"],
    ["file scheme", "file:///etc/passwd"],
    ["not a url", "huggingnews"],
  ];
  it.each(cases)("%s", async (_name, url) => {
    const fetchImpl = fetchReturning(() => xmlResponse(GOOD_XML));
    await expect(fetchFeed({ url, fetchImpl })).rejects.toThrow(FeedFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts another path on the same host", async () => {
    const fetchImpl = fetchReturning(() => xmlResponse(GOOD_XML));
    await fetchFeed({ url: "https://huggingnews.com/other.xml", fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://huggingnews.com/other.xml");
  });
});

describe("fetchFeed: HTTP status", () => {
  it.each([204, 304, 403, 404, 429, 500, 503])("status %i -> FeedFetchError", async (status) => {
    // Null-body statuses (204, 304) cannot carry a body, even an empty one.
    const fetchImpl = fetchReturning(() => new Response(null, { status }));
    const err = await fetchFeed({ fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect((err as Error).message).toContain(String(status));
  });
});

describe("fetchFeed: redirects", () => {
  it("refuses a redirect to another host and does not follow it", async () => {
    const fetchImpl = fetchReturning(() => redirect("https://evil.example/feed.xml"));
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["http downgrade on the same host", "http://huggingnews.com/feed.xml"],
    ["protocol-relative to another host", "//evil.example/feed.xml"],
    ["credentials trick", "https://huggingnews.com@evil.example/feed.xml"],
  ])("refuses %s", async (_name, to) => {
    const fetchImpl = fetchReturning(() => redirect(to));
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect with no Location", async () => {
    const fetchImpl = fetchReturning(() => new Response(null, { status: 302 }));
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
  });

  it("follows same-host redirects, relative or absolute", async () => {
    const responses = [
      redirect("/moved.xml"),
      redirect("https://huggingnews.com/moved-again.xml", 308),
      xmlResponse(GOOD_XML),
    ];
    const fetchImpl = fetchReturning(() => responses.shift()!);
    const result = await fetchFeed({ fetchImpl });
    expect(result.entries).toHaveLength(1);
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual([
      FEED_URL,
      "https://huggingnews.com/moved.xml",
      "https://huggingnews.com/moved-again.xml",
    ]);
  });

  it("gives up after 3 redirects", async () => {
    const fetchImpl = fetchReturning(() => redirect("/again.xml"));
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // the first request plus 3 redirects
  });
});

describe("fetchFeed: size cap", () => {
  it("rejects a 2 MB body and stops reading well before the end", async () => {
    const huge = feed(entry({ summary: "x".repeat(2 * 1024 * 1024) }));
    const bytes = new TextEncoder().encode(huge);
    const CHUNK = 64 * 1024;
    let pulled = 0;
    const fetchImpl = fetchReturning(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (pulled * CHUNK >= bytes.length) return controller.close();
              controller.enqueue(bytes.slice(pulled * CHUNK, (pulled + 1) * CHUNK));
              pulled++;
            },
          }),
          // No Content-Length: the cap must hold on the stream alone.
        ),
    );
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
    // Stopped just past the cap (plus a little read-ahead), not at the end.
    expect(pulled * CHUNK).toBeLessThanOrEqual(1024 * 1024 + 3 * CHUNK);
    expect(pulled * CHUNK).toBeLessThan(bytes.length);
  });

  it("rejects a body that lies about being small", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    const fetchImpl = fetchReturning(
      () => new Response(big, { status: 200, headers: { "content-length": "100" } }),
    );
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
  });

  it("accepts a body of exactly 1 MB", async () => {
    const xml = feed(entry({ summary: "" }));
    const padded = xml.replace("</feed>", " ".repeat(1024 * 1024 - xml.length) + "</feed>");
    expect(new TextEncoder().encode(padded).length).toBe(1024 * 1024);
    const result = await fetchFeed({ fetchImpl: fetchReturning(() => xmlResponse(padded)) });
    expect(result.entries).toHaveLength(1);
  });
});

describe("fetchFeed: failures become FeedFetchError with no raw detail", () => {
  it("passes a 20 s AbortSignal.timeout and reports a timeout", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(AbortSignal.abort(new DOMException("deadline", "TimeoutError")));
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      init?.signal?.throwIfAborted();
      return xmlResponse(GOOD_XML);
    });

    const err = await fetchFeed({ fetchImpl }).catch((e: unknown) => e);
    expect(timeout).toHaveBeenCalledWith(20_000);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect((err as Error).message).toMatch(/timed out/);
  });

  it("network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed ECONNRESET 10.0.0.7");
    });
    const err = await fetchFeed({ fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedFetchError);
    expect((err as Error).message).not.toMatch(/ECONNRESET|10\.0\.0\.7/);
  });

  it("connection dropped mid-body", async () => {
    const fetchImpl = fetchReturning(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("<feed>"));
              c.error(new Error("socket hang up"));
            },
          }),
        ),
    );
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedFetchError);
  });
});

describe("fetchFeed: a 200 that is not a feed", () => {
  it.each([
    ["HTML", "<html><body>Maintenance</body></html>"],
    ["DOCTYPE", '<!DOCTYPE feed [<!ENTITY a "b">]>' + feed(entry())],
    ["empty body", ""],
  ])("%s -> FeedParseError", async (_name, body) => {
    const fetchImpl = fetchReturning(() => xmlResponse(body));
    await expect(fetchFeed({ fetchImpl })).rejects.toThrow(FeedParseError);
  });
});
