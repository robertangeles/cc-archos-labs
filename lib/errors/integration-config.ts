// Named error classes for the integration-config subsystem. Same pattern
// as lib/errors/booking.ts. Callers narrow with `instanceof` to decide
// whether to log + exit (master key missing), log + return null (decrypt
// failure, post-grace), or surface a field-level UI error (validation).
//
// See wiki/concepts/integration-config.md for the rescue map. The cardinal
// rule: a decrypt failure is NEVER recoverable by falling back to env.
// It signals either a wrong master key or a tampered DB row — both
// require human intervention.

export class IntegrationConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

// BOOKING_ENCRYPTION_KEY env var is absent or wrong length. App cannot
// decrypt anything — should exit at boot. Caller logs + process.exit(1).
export class MasterKeyMissingError extends IntegrationConfigError {}

// Expected DB row (key='integration_secrets') is absent. During the
// 7-day grace window the loader falls back to env vars; after grace it
// throws this. Signals "migration never ran" or "row was deleted".
export class IntegrationConfigNotFoundError extends IntegrationConfigError {}

// AES-GCM decrypt failed. EITHER the ciphertext was tampered with OR the
// master key is wrong OR the key was rotated without re-encrypting this
// row. App MUST NOT fall back to env on this — it would silently hide
// a real security signal. Caller logs + process.exit(1).
export class IntegrationConfigDecryptError extends IntegrationConfigError {}

// Decrypted JSON failed the Zod schema. Schema drift (a field renamed
// in code but not migrated) or DB row was hand-edited. Caller logs +
// uses defaults for fields that have defaults; throws for required
// secrets that are missing.
export class IntegrationConfigValidationError extends IntegrationConfigError {
  /** Field names that failed validation, surfaced for admin UI display. */
  readonly fields: readonly string[];

  constructor(
    message: string,
    fields: readonly string[],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.fields = fields;
  }
}
