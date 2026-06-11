import "server-only";

const XRPC_BASE = "https://bsky.social/xrpc";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface AtprotoSession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

interface AtprotoProfile {
  did: string;
  handle: string;
  displayName?: string;
}

interface AtprotoRecord {
  uri: string;
  cid: string;
}

interface AtprotoError {
  error: string;
  message: string;
}

// --------------------------------------------------------------------------
// AT Protocol helpers
// --------------------------------------------------------------------------

/**
 * Authenticate with Bluesky using a handle and app password.
 * Returns the session containing access/refresh JWTs and the DID.
 */
export async function connectBluesky(
  handle: string,
  appPassword: string,
): Promise<AtprotoSession> {
  const res = await fetch(`${XRPC_BASE}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as AtprotoError | null;
    const msg = body?.message ?? "Authentication failed";
    throw new BlueskyAuthError(msg, res.status);
  }

  return (await res.json()) as AtprotoSession;
}

/**
 * Refresh an existing Bluesky session using the refresh JWT.
 * Returns a fresh session with new access/refresh JWTs.
 */
export async function refreshBlueskySession(
  refreshToken: string,
): Promise<AtprotoSession> {
  const res = await fetch(`${XRPC_BASE}/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as AtprotoError | null;
    const msg = body?.message ?? "Session refresh failed";
    throw new BlueskyAuthError(msg, res.status);
  }

  return (await res.json()) as AtprotoSession;
}

/**
 * Re-authenticate using the stored app password when refresh fails.
 * Alias for connectBluesky kept for semantic clarity at call sites.
 */
export async function getBlueskySession(
  appPassword: string,
  handle: string,
): Promise<AtprotoSession> {
  return connectBluesky(handle, appPassword);
}

/**
 * Fetch a Bluesky profile by DID.
 */
export async function getBlueskyProfile(
  accessToken: string,
  did: string,
): Promise<AtprotoProfile> {
  const res = await fetch(
    `${XRPC_BASE}/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as AtprotoError | null;
    throw new BlueskyApiError(
      body?.message ?? "Failed to fetch profile",
      res.status,
    );
  }

  return (await res.json()) as AtprotoProfile;
}

/**
 * Publish a post to Bluesky.
 * Returns the AT URI and CID of the created record plus a web URL.
 */
export async function publishToBluesky(
  accessToken: string,
  did: string,
  handle: string,
  content: string,
): Promise<{ uri: string; cid: string; url: string }> {
  const res = await fetch(`${XRPC_BASE}/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      repo: did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text: content,
        createdAt: new Date().toISOString(),
      },
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as AtprotoError | null;
    throw new BlueskyApiError(
      body?.message ?? "Failed to publish post",
      res.status,
    );
  }

  const record = (await res.json()) as AtprotoRecord;
  const rkey = record.uri.split("/").pop();
  const url = `https://bsky.app/profile/${handle}/post/${rkey}`;

  return { uri: record.uri, cid: record.cid, url };
}

// --------------------------------------------------------------------------
// Error classes
// --------------------------------------------------------------------------

export class BlueskyAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "BlueskyAuthError";
  }
}

export class BlueskyApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "BlueskyApiError";
  }
}
