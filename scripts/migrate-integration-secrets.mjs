// Migrate integration secrets from env vars into the encrypted DB row.
//
// One-shot script. Idempotent — running twice is safe. Reads every
// integration env var, encrypts the secrets with BOOKING_ENCRYPTION_KEY,
// writes them as a single site_setting row keyed 'integration_secrets'.
// Audit-log row written per migrated field.
//
// Usage:
//   pnpm migrate-integration-secrets               # writes to the DB pointed at by DATABASE_URL
//   pnpm migrate-integration-secrets --dry-run     # prints what would be written, no DB write
//
// Run from .env.local locally (which shares the prod DB), or from a
// one-shot shell on Render with the right env vars set.
//
// Implementation: crypto is inlined here (same AES-256-GCM format as
// lib/booking-crypto.ts) so this script has no TS dependency and can
// run with plain Node. The duplication is intentional — the script is
// an operator tool, the library is the runtime. Both verified against
// the same test vectors in lib/integration-config.test.ts.

import {
  createCipheriv,
  randomBytes,
} from "node:crypto";
import postgres from "postgres";

// ---- Args ------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ---- Crypto (mirrors lib/booking-crypto.ts encrypt()) ---------------------

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.BOOKING_ENCRYPTION_KEY;
  if (!raw) {
    console.error("BOOKING_ENCRYPTION_KEY not set — cannot encrypt secrets.");
    process.exit(1);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    console.error(
      `BOOKING_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`,
    );
    process.exit(1);
  }
  return key;
}

function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

// ---- Field plan ------------------------------------------------------------
// Mirrors lib/integration-config-shared.ts ENCRYPTED_FIELDS + the schema.
// If a field is added to the shared file, add it here too.

const ENCRYPTED_FIELDS = ["adminPassword", "resendApiKey", "llmApiKey"];
const PLAINTEXT_FIELDS = [
  "contactRecipientEmail",
  "resendFromEmail",
  "llmModelId",
];

// Maps each config field to the env var name it migrates from. Field
// names are provider-agnostic (llmApiKey, llmModelId); env vars retain
// their historical provider-specific names to avoid Render-dashboard
// churn during the migration.
const ENV_VAR_FOR = {
  adminPassword: "ADMIN_PASSWORD",
  resendApiKey: "RESEND_API_KEY",
  llmApiKey: "OPENROUTER_API_KEY",
  contactRecipientEmail: "CONTACT_RECIPIENT_EMAIL",
  resendFromEmail: "RESEND_FROM_EMAIL",
  llmModelId: "CLAUDE_MODEL_ID",
};

// Fallback defaults (mirror lib/integration-config-shared CONFIG_DEFAULTS).
const DEFAULTS = {
  contactRecipientEmail: "rob.angeles@archoslabs.xyz",
  resendFromEmail: "Archos Labs <hello@archoslabs.xyz>",
  llmModelId: null,
};

// ---- Main ------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const key = getKey();

  // Build the new stored blob from current env values.
  const stored = {};
  const written = [];
  const skipped = [];

  for (const field of ENCRYPTED_FIELDS) {
    const raw = process.env[ENV_VAR_FOR[field]];
    if (!raw) {
      skipped.push(field);
      continue;
    }
    stored[field] = encrypt(raw, key);
    written.push(field);
  }

  for (const field of PLAINTEXT_FIELDS) {
    const raw = process.env[ENV_VAR_FOR[field]];
    if (raw) {
      stored[field] = raw;
      written.push(field);
    } else if (field in DEFAULTS) {
      stored[field] = DEFAULTS[field];
      // Defaults count as "written" because the JSONB row gets the value;
      // the audit log distinguishes "from env" vs "from default" only
      // through the operation log message at print-time below.
      written.push(field);
    } else {
      skipped.push(field);
    }
  }

  console.log("Migration plan:");
  for (const field of written) {
    const isEnc = ENCRYPTED_FIELDS.includes(field);
    const fromDefault =
      !process.env[ENV_VAR_FOR[field]] && field in DEFAULTS;
    const source = fromDefault ? "(default)" : `(from ${ENV_VAR_FOR[field]})`;
    const value = isEnc ? `[encrypted ${stored[field].length} chars]` : stored[field];
    console.log(`  ${field.padEnd(22)} ← ${value} ${source}`);
  }
  if (skipped.length > 0) {
    console.log("\nSkipped (env var missing, no default):");
    for (const field of skipped) {
      console.log(`  ${field.padEnd(22)} env var ${ENV_VAR_FOR[field]}`);
    }
  }

  if (dryRun) {
    console.log("\nDry-run — no DB write.");
    return;
  }

  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });
  try {
    await sql.begin(async (tx) => {
      // Upsert: insert if missing, update if present.
      const existing = await tx`
        SELECT value FROM site_setting WHERE key = 'integration_secrets' LIMIT 1
      `;
      const isCreate = existing.length === 0;

      // Merge with existing values (preserves anything already in the
      // row that we didn't migrate this run).
      const currentValue = isCreate ? {} : existing[0].value;
      const mergedValue = { ...currentValue, ...stored };

      await tx`
        INSERT INTO site_setting (key, value, created_at, updated_at)
        VALUES ('integration_secrets', ${tx.json(mergedValue)}, now(), now())
        ON CONFLICT (key) DO UPDATE
        SET value = ${tx.json(mergedValue)}, updated_at = now()
      `;

      // Audit log: one row per migrated field. Use 'created' if this is
      // the first write to the row; 'updated' if the row already existed.
      const operation = isCreate ? "created" : "updated";
      for (const field of written) {
        const keyName = field.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        await tx`
          INSERT INTO integration_secret_audit (key_name, operation, actor)
          VALUES (${keyName}, ${operation}, 'migration')
        `;
      }
    });

    console.log(
      `\n✓ ${written.length} field(s) written to integration_secrets. ${skipped.length} skipped.`,
    );
    console.log(
      "  Next: smoke-test the affected flows BEFORE removing env vars from Render dashboard.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
