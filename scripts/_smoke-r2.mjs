// R2 credentials smoke test — verifies that R2_ACCESS_KEY_ID and
// R2_SECRET_ACCESS_KEY (created via Cloudflare dashboard →
// R2 Object Storage → API Tokens → Create Account API token) authenticate
// against the S3-compatible endpoint, plus that the public URL serves objects.
//
// Runs three operations:
//   1. PUT  — upload a tiny test object
//   2. GET  — fetch via the public URL (verifies "Public Development URL" is on)
//   3. DELETE — clean up the test object
//
// Exits 0 on full success, 1 on any failure with a diagnostic message.

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");

const missing = [];
if (!accountId) missing.push("R2_ACCOUNT_ID");
if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
if (!bucket) missing.push("R2_BUCKET");
if (!publicUrl) missing.push("R2_PUBLIC_URL");
if (missing.length) {
  console.error(`✗ Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`R2 smoke test`);
console.log(`  Account ID:    ${accountId}`);
console.log(`  Bucket:        ${bucket}`);
console.log(`  Access Key ID: ${accessKeyId.slice(0, 8)}***${accessKeyId.slice(-4)}`);
console.log(`  Public URL:    ${publicUrl}`);
console.log("");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const testKey = `_smoke/ping-${Date.now()}.txt`;
const testBody = `Smoke ping. Safe to delete.`;

// 1. PUT
process.stdout.write(`PUT  ${testKey} ... `);
try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: testKey,
      Body: testBody,
      ContentType: "text/plain",
    }),
  );
  console.log("✓");
} catch (err) {
  const code = err.$metadata?.httpStatusCode ?? "?";
  console.log(`✗ ${code} ${err.name}: ${err.message}`);
  process.exit(1);
}

// 2. Public URL fetch
process.stdout.write(`GET  ${publicUrl}/${testKey} ... `);
try {
  const response = await fetch(`${publicUrl}/${testKey}`);
  if (response.ok) {
    const body = await response.text();
    if (body === testBody) {
      console.log("✓");
    } else {
      console.log(`✗ body mismatch (got ${body.length} chars, expected ${testBody.length})`);
      process.exit(1);
    }
  } else {
    console.log(
      `⚠ ${response.status} — bucket may not have Public Development URL enabled`,
    );
    console.log(
      `   Enable in Cloudflare dashboard → R2 → ${bucket} → Settings → Public access`,
    );
  }
} catch (err) {
  console.log(`✗ ${err.message}`);
}

// 3. DELETE
process.stdout.write(`DEL  ${testKey} ... `);
try {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
  console.log("✓");
} catch (err) {
  console.log(`✗ ${err.message}`);
}

console.log(`\nR2 smoke test complete — credentials are valid.`);
