import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  oauthSelectMock,
  oauthInsertMock,
  usersSelectMock,
  usersInsertMock,
} = vi.hoisted(() => ({
  oauthSelectMock: vi.fn(),
  oauthInsertMock: vi.fn(),
  usersSelectMock: vi.fn(),
  usersInsertMock: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: { __tag?: string }) => ({
        where: () => ({
          limit:
            table.__tag === "oauth_account"
              ? oauthSelectMock
              : usersSelectMock,
        }),
      }),
    }),
    insert: (table: { __tag?: string }) => ({
      values: (vals: unknown) => {
        if (table.__tag === "oauth_account") {
          oauthInsertMock(vals);
          return Promise.resolve(undefined);
        }
        return { returning: () => usersInsertMock(vals) };
      },
    }),
  }),
}));

vi.mock("../db/schema", () => ({
  users: { __tag: "users" },
  oauthAccount: { __tag: "oauth_account" },
}));

// Stub issueSession — exercised separately in session integration; this
// module only needs the type signature.
vi.mock("./session", () => ({
  issueSession: vi.fn().mockResolvedValue({
    cookieValue: "test-jwt",
    sessionId: "sess-1",
    expiresAt: new Date(),
  }),
}));

import {
  buildAuthorizeUrl,
  GoogleSigninNotConfiguredError,
  getGoogleSigninConfig,
  exchangeCodeForToken,
  fetchGoogleUserinfo,
  linkOrCreateUserFromGoogle,
} from "./oauth-google";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_SIGNIN_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "test-client-secret");

  oauthSelectMock.mockResolvedValue([]);
  oauthInsertMock.mockResolvedValue(undefined);
  usersSelectMock.mockResolvedValue([]);
  usersInsertMock.mockResolvedValue([{ id: "new-user-1" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getGoogleSigninConfig", () => {
  it("returns config when env vars are present", () => {
    const c = getGoogleSigninConfig("https://archoslabs.xyz/cb");
    expect(c).toEqual({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "https://archoslabs.xyz/cb",
    });
  });

  it("throws GoogleSigninNotConfiguredError when client id missing", () => {
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_ID", "");
    expect(() => getGoogleSigninConfig("x")).toThrow(
      GoogleSigninNotConfiguredError,
    );
  });

  it("throws GoogleSigninNotConfiguredError when client secret missing", () => {
    vi.stubEnv("GOOGLE_SIGNIN_CLIENT_SECRET", "");
    expect(() => getGoogleSigninConfig("x")).toThrow(
      GoogleSigninNotConfiguredError,
    );
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds URL with all required params + select_account prompt", () => {
    const url = buildAuthorizeUrl({
      config: {
        clientId: "cid",
        clientSecret: "csecret",
        redirectUri: "https://archoslabs.xyz/api/auth/google/callback",
      },
      state: "csrf-nonce-abc",
    });
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
    expect(url).toContain("client_id=cid");
    expect(url).toContain("response_type=code");
    expect(url).toContain("scope=openid+email+profile");
    expect(url).toContain("state=csrf-nonce-abc");
    expect(url).toContain("prompt=select_account");
    expect(url).toContain(
      "redirect_uri=https%3A%2F%2Farchoslabs.xyz%2Fapi%2Fauth%2Fgoogle%2Fcallback",
    );
    // Sign-in flow must NOT request offline access (no refresh token).
    expect(url).not.toContain("access_type=offline");
  });
});

describe("exchangeCodeForToken", () => {
  it("returns parsed token on 200", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at",
          expires_in: 3600,
          scope: "openid email profile",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await exchangeCodeForToken({
      config: {
        clientId: "cid",
        clientSecret: "csecret",
        redirectUri: "https://archoslabs.xyz/cb",
      },
      code: "auth-code-abc",
    });
    expect(result?.access_token).toBe("at");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/x-www-form-urlencoded",
        }),
      }),
    );
  });

  it("returns null on non-2xx", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("bad code", { status: 400 }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await exchangeCodeForToken({
      config: {
        clientId: "cid",
        clientSecret: "csecret",
        redirectUri: "https://archoslabs.xyz/cb",
      },
      code: "bad",
    });
    expect(r).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  it("returns null on network error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("ENETUNREACH"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await exchangeCodeForToken({
      config: {
        clientId: "cid",
        clientSecret: "csecret",
        redirectUri: "https://archoslabs.xyz/cb",
      },
      code: "x",
    });
    expect(r).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("fetchGoogleUserinfo", () => {
  it("returns userinfo on 200 with required fields", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sub: "google-sub-123",
          email: "user@example.com",
          email_verified: true,
          name: "Alice Example",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await fetchGoogleUserinfo("at");
    expect(r?.sub).toBe("google-sub-123");
    expect(r?.email).toBe("user@example.com");
    expect(r?.email_verified).toBe(true);
  });

  it("returns null when sub or email is missing", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "no-id" }), { status: 200 }),
    );
    expect(await fetchGoogleUserinfo("at")).toBeNull();
  });

  it("returns null on non-2xx", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("unauth", { status: 401 }),
    );
    expect(await fetchGoogleUserinfo("bad")).toBeNull();
  });
});

describe("linkOrCreateUserFromGoogle — three branches", () => {
  const VERIFIED_USERINFO = {
    sub: "google-sub-abc",
    email: "alice@example.com",
    email_verified: true,
    name: "Alice Example",
  };

  it("branch 1: existing (provider, subject) link → login as linked user", async () => {
    oauthSelectMock.mockResolvedValueOnce([{ userId: "user-existing" }]);
    usersSelectMock.mockResolvedValueOnce([
      { id: "user-existing", isActive: true },
    ]);

    const r = await linkOrCreateUserFromGoogle(VERIFIED_USERINFO);
    expect(r).toEqual({
      userId: "user-existing",
      newlyCreated: false,
      newlyLinked: false,
    });
    expect(oauthInsertMock).not.toHaveBeenCalled();
    expect(usersInsertMock).not.toHaveBeenCalled();
  });

  it("branch 1: linked user is deactivated → throws", async () => {
    oauthSelectMock.mockResolvedValueOnce([{ userId: "user-existing" }]);
    usersSelectMock.mockResolvedValueOnce([
      { id: "user-existing", isActive: false },
    ]);
    await expect(
      linkOrCreateUserFromGoogle(VERIFIED_USERINFO),
    ).rejects.toThrow(/deactivated/);
  });

  it("branch 2: user exists by email, no link yet → inserts oauth_account", async () => {
    oauthSelectMock.mockResolvedValueOnce([]);
    usersSelectMock.mockResolvedValueOnce([
      { id: "user-by-email", isActive: true },
    ]);

    const r = await linkOrCreateUserFromGoogle(VERIFIED_USERINFO);
    expect(r).toEqual({
      userId: "user-by-email",
      newlyCreated: false,
      newlyLinked: true,
    });
    expect(oauthInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-by-email",
        provider: "google",
        providerSubject: "google-sub-abc",
        emailAtLink: "alice@example.com",
      }),
    );
    expect(usersInsertMock).not.toHaveBeenCalled();
  });

  it("branch 2: existing user is deactivated → throws (no link write)", async () => {
    oauthSelectMock.mockResolvedValueOnce([]);
    usersSelectMock.mockResolvedValueOnce([
      { id: "user-by-email", isActive: false },
    ]);
    await expect(
      linkOrCreateUserFromGoogle(VERIFIED_USERINFO),
    ).rejects.toThrow(/deactivated/);
    expect(oauthInsertMock).not.toHaveBeenCalled();
  });

  it("branch 3: brand-new user → creates users row + oauth_account row", async () => {
    oauthSelectMock.mockResolvedValueOnce([]);
    usersSelectMock.mockResolvedValueOnce([]);
    usersInsertMock.mockResolvedValueOnce([{ id: "user-new-1" }]);

    const r = await linkOrCreateUserFromGoogle(VERIFIED_USERINFO);
    expect(r).toEqual({
      userId: "user-new-1",
      newlyCreated: true,
      newlyLinked: true,
    });
    expect(usersInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        displayName: "Alice Example",
        role: "member",
        isActive: true,
        tokenVersion: 0,
      }),
    );
    expect(oauthInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-new-1",
        provider: "google",
        providerSubject: "google-sub-abc",
      }),
    );
  });
});
