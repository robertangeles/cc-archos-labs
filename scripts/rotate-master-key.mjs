// Rotate the AES-256-GCM master key used to encrypt integration_secrets.
//
// Reads the current site_setting row, decrypts every encrypted field
// with the OLD key, re-encrypts with the NEW key, writes back in a
// single transaction. If the process is killed mid-way, the original
// row is preserved (transaction rolls back).
//
// Usage:
//   pnpm rotate-master-key --old <old-key-base64> --new <new-key-base64>
//   pnpm rotate-master-key --new $(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
//     # If --old is omitted, defaults to BOOKING_ENCRYPTION_KEY (current env value).
//
// After this returns successfully:
//   1. Copy the new key into Render dashboard BOOKING_ENCRYPTION_KEY.
//   2. Restart the service (manual deploy or env-change auto-redeploy).
//   3. Verify /admin/integrations loads — proves decrypt works with new key.
//
// Doing it in the wrong order:
//   - Update Render env BEFORE rotating DB → app can't decrypt current row.
//     Recovery: revert env, re-run script, retry.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import postgres from "postgres";

// ---- Args ------------------------------------------------------------------

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args[i + 1] ?? null;
}

const oldKeyB64 = flagValue("--old") ?? process.env.BOOKING_ENCRYPTION_KEY;
const newKeyB64 = flagValue("--new");

if (!oldKeyB64) {
  console.error(
    "Old master key missing — pass --old <base64> or set BOOKING_ENCRYPTION_KEY.",
  );
  process.exit(1);
}
if (!newKeyB64) {
  console.error(
    "New master key missing — pass --new <base64>. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
  );
  process.exit(1);
}

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

const oldKey = Buffer.from(oldKeyB64, "base64");
const newKey = Buffer.from(newKeyB64, "base64");
if (oldKey.length !== KEY_LENGTH || newKey.length !== KEY_LENGTH) {
  console.error(
    `Both keys must decode to ${KEY_LENGTH} bytes. ` +
      `Got old=${oldKey.length}, new=${newKey.length}.`,
  );
  process.exit(1);
}
if (Buffer.compare(oldKey, newKey) === 0) {
  console.error("Old and new keys are identical — nothing to rotate.");
  process.exit(1);
}

// ---- Crypto (mirrors lib/booking-crypto.ts) ------------------------------

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

function decrypt(blob, key) {
  const bytes = Buffer.from(blob, "base64");
  if (bytes.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error(
      `ciphertext too short (${bytes.length} bytes, expected at least ${IV_LENGTH + TAG_LENGTH})`,
    );
  }
  const iv = bytes.subarray(0, IV_LENGTH);
  const tag = bytes.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = bytes.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

const ENCRYPTED_FIELDS = ["adminPassword", "resendApiKey", "openrouterApiKey"];

// ---- Main ------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });
  let fieldsRotated = 0;
  try {
    await sql.begin(async (tx) => {
      const rows = await tx`
        SELECT value FROM site_setting WHERE key = 'integration_secrets' LIMIT 1
      `;
      if (rows.length === 0) {
        console.error(
          "No integration_secrets row found. Run pnpm migrate-integration-secrets first.",
        );
        process.exit(1);
      }
      const stored = rows[0].value;
      const rotated = { ...stored };

      for (const field of ENCRYPTED_FIELDS) {
        if (typeof stored[field] !== "string" || stored[field].length === 0) {
          console.error(
            `Field '${field}' missing or empty in the DB row — refusing to rotate a malformed row.`,
          );
          process.exit(1);
        }
        let plaintext;
        try {
          plaintext = decrypt(stored[field], oldKey);
        } catch (err) {
          console.error(
            `Decrypt failed for '${field}' with the OLD key. Wrong --old key?`,
          );
          console.error("Underlying error:", err.message);
          process.exit(1);
        }
        rotated[field] = encrypt(plaintext, newKey);
        fieldsRotated++;
      }

      await tx`
        UPDATE site_setting
        SET value = ${tx.json(rotated)}, updated_at = now()
        WHERE key = 'integration_secrets'
      `;

      await tx`
        INSERT INTO integration_secret_audit (key_name, operation, actor)
        VALUES ('_master_key', 'rotated_master_key', 'admin')
      `;
    });

    console.log(`✓ Rotated ${fieldsRotated} encrypted field(s).`);
    console.log("\nNEXT STEPS — do these in order:");
    console.log("  1. Update Render dashboard BOOKING_ENCRYPTION_KEY env var:");
    console.log(`     ${newKeyB64}`);
    console.log("  2. Trigger a manual restart on Render (or wait for env-change auto-redeploy).");
    console.log("  3. Sign in to /admin/integrations and verify all values render.");
    console.log("  4. If anything is broken, revert the env var to the old key and re-run this script with --old/--new swapped.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nRotation failed:", err);
  process.exit(1);
});
