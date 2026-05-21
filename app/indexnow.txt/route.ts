// /indexnow.txt — IndexNow key file. Returns the literal value of
// INDEXNOW_KEY as plain text so participating engines (Bing, Yandex,
// Naver, Seznam, Yep, Amazon) can verify ownership when we POST URL
// lists to api.indexnow.org. The `keyLocation` parameter in every
// outgoing ping points HERE.
//
// Per the IndexNow spec, hosting the key file at a non-root path (the
// canonical place would be /{key}.txt) constrains the "valid for
// indexing" URL scope to the directory containing the key file. Our
// keyLocation is `https://archoslabs.xyz/indexnow.txt` — directory `/`
// — so every public URL on the domain remains eligible.
//
// Returns 503 when the env var is unset so misconfiguration surfaces
// loudly during deploy rather than silently breaking IndexNow pings.

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    return new Response("IndexNow key not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Engines cache the key. A long cache is fine — rotation requires
      // a redeploy that bumps the build, which invalidates the CDN.
      "cache-control": "public, max-age=3600",
    },
  });
}
