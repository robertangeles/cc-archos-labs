import { describe, expect, it } from "vitest";
import {
  BookingError,
  ClaudeParseError,
  CryptoError,
  GoogleAuthError,
  GoogleAuthErrorRevoked,
  JWTRevokedError,
  SlotConflictError,
} from "./booking";

// Smoke tests for the error hierarchy. The contract callers rely on is:
// (1) every subclass is `instanceof BookingError` — catch-all fallback,
// (2) revoked is `instanceof GoogleAuthError` — narrowed handling still
// works, (3) name is the class name — structured logs see it, (4) cause
// passes through the standard ErrorOptions API.

describe("booking error hierarchy", () => {
  it("every subclass is instanceof BookingError", () => {
    expect(new GoogleAuthError("x") instanceof BookingError).toBe(true);
    expect(new ClaudeParseError("x") instanceof BookingError).toBe(true);
    expect(new SlotConflictError("x") instanceof BookingError).toBe(true);
    expect(new CryptoError("x") instanceof BookingError).toBe(true);
    expect(new JWTRevokedError("x") instanceof BookingError).toBe(true);
  });

  it("revoked is still instanceof GoogleAuthError for narrowed handling", () => {
    const err = new GoogleAuthErrorRevoked("token revoked");
    expect(err instanceof GoogleAuthErrorRevoked).toBe(true);
    expect(err instanceof GoogleAuthError).toBe(true);
    expect(err instanceof BookingError).toBe(true);
  });

  it("sets name to the class name so logs are discriminable", () => {
    expect(new GoogleAuthError("x").name).toBe("GoogleAuthError");
    expect(new ClaudeParseError("x").name).toBe("ClaudeParseError");
    expect(new GoogleAuthErrorRevoked("x").name).toBe(
      "GoogleAuthErrorRevoked",
    );
  });

  it("forwards cause through ErrorOptions", () => {
    const root = new Error("network");
    const err = new GoogleAuthError("failed to refresh", { cause: root });
    expect(err.cause).toBe(root);
  });
});
