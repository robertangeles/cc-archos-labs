// Reset the admin password directly in the DB. Recovery tool for the
// "I forgot the admin password" case after migration.
//
// Usage:
//   pnpm reset-admin-password "<new-password>"
//
// Encrypts the new password with BOOKING_ENCRYPTION_KEY and writes it
// to the integration_secrets row. Audit-log row written with
// operation='updated', actor='cli'.
//
// Constraints:
//   - New password must be >= 8 characters (matches the schema floor).
//   - Surrounding spaces are stripped — admins don't typically want
//     a leading-space password they can't reproduce reliably.

import { createCipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

// ---- Args ------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith("--")) {
  console.error("Usage: pnpm reset-admin-password \"<new-password>\"");
  process.exit(1);
}
const newPassword = args[0].trim();
if (newPassword.length < 8) {
  console.error("New password must be at least 8 characters.");
  process.exit(1);
}

// ---- Crypto ----------------------------------------------------------------

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.BOOKING_ENCRYPTION_KEY;
  if (!raw) {
    console.error("BOOKING_ENCRYPTION_KEY not set — cannot encrypt.");
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

// ---- Main ------------------------------------------------------------------

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const key = getKey();
  const encryptedPassword = encrypt(newPassword, key);

  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });
  try {
    await sql.begin(async (tx) => {
      const existing = await tx`
        SELECT value FROM site_setting WHERE key = 'integration_secrets' LIMIT 1
      `;
      if (existing.length === 0) {
        // Initialise the row with just the password set. Other fields
        // will be filled by migrate-integration-secrets or the admin UI.
        const initial = { adminPassword: encryptedPassword };
        await tx`
          INSERT INTO site_setting (key, value, created_at, updated_at)
          VALUES ('integration_secrets', ${tx.json(initial)}, now(), now())
        `;
        await tx`
          INSERT INTO integration_secret_audit (key_name, operation, actor)
          VALUES ('admin_password', 'created', 'cli')
        `;
        console.log("✓ Admin password set (new integration_secrets row created).");
        return;
      }

      const current = existing[0].value;
      const merged = { ...current, adminPassword: encryptedPassword };
      await tx`
        UPDATE site_setting
        SET value = ${tx.json(merged)}, updated_at = now()
        WHERE key = 'integration_secrets'
      `;
      await tx`
        INSERT INTO integration_secret_audit (key_name, operation, actor)
        VALUES ('admin_password', 'updated', 'cli')
      `;
      console.log("✓ Admin password updated.");
    });
    console.log("\nYou can now sign in to /admin/login with the new password.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nReset failed:", err);
  process.exit(1);
});
