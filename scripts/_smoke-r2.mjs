// One-shot R2 credentials smoke test for the rosy-bee migration.
// Runs PUT → GET (via public URL) → DELETE against the configured bucket
// so any auth / bucket / public-access misconfig surfaces immediately
// instead of waiting until the pilot run hits the media-rehost stage.
//
// Uses Cloudflare's R2 REST API with Bearer auth (Account API token model).
// Reads R2_* env vars from .env.local (loaded by node --env-file=).
// Throwaway tooling — leading underscore marks it as not-load-bearing.
//
// Run:
//   node --env-file=.env.local scripts/_smoke-r2.mjs

const accountId = process.env.R2_ACCOUNT_ID;
const apiToken = process.env.R2_API_TOKEN;
const bucket = process.env.R2_BUCKET;
const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");

// Env sanity (don't print secret values).
const missing = [];
if (!accountId) missing.push("R2_ACCOUNT_ID");
if (!apiToken) missing.push("R2_API_TOKEN");
if (!bucket) missing.push("R2_BUCKET");
if (!publicUrl) missing.push("R2_PUBLIC_URL");
if (missing.length) {
  console.error(`✗ Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`R2 smoke test (Bearer auth via Cloudflare REST API)`);
console.log(`  Account ID: ${accountId}`);
console.log(`  Bucket:     ${bucket}`);
console.log(`  Public URL: ${publicUrl}`);
console.log(`  Token:      ${apiToken.slice(0, 8)}***${apiToken.slice(-4)} (${apiToken.length} chars)`);
console.log("");

const testKey = `_smoke/ping-${Date.now()}.txt`;
const testBody = `R2 smoke test from migrate-wp tooling. Generated ${new Date().toISOString()}. Safe to delete.`;
const objectsBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;

// Preflight: verify the token authenticates AT ALL against Cloudflare's API.
// /accounts/{id} returns 200 with account info if the token can read this
// account; 401/403 if not. Cheap, no side effects.
try {
  console.log(`[preflight] Verifying token can reach the account...`);
  const accountUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  const acctResp = await fetch(accountUrl, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (acctResp.ok) {
    console.log(`  ✓ Token authenticates against the account.`);
  } else {
    console.log(
      `  ✗ Token failed account-level check: ${acctResp.status} ${acctResp.statusText}`,
    );
    console.log(
      `    The token doesn't authenticate at all. Most likely cause: the token in .env.local`,
    );
    console.log(
      `    is stale (you rolled it again after copying), or there's a copy-paste issue.`,
    );
  }

  // Preflight 2: can the token list R2 buckets in this account?
  console.log(`[preflight] Verifying token can list R2 buckets...`);
  const bucketsResp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (bucketsResp.ok) {
    const data = await bucketsResp.json();
    const names = (data.result?.buckets ?? []).map((b) => b.name).join(", ");
    console.log(`  ✓ Token can list R2 buckets: [${names || "(none)"}]`);
  } else {
    console.log(
      `  ✗ Token failed R2 buckets list: ${bucketsResp.status} ${bucketsResp.statusText}`,
    );
    console.log(
      `    The token authenticates against the account but lacks R2 read permission.`,
    );
  }
  console.log("");
} catch (preflightErr) {
  console.log(`[preflight] error: ${preflightErr.message}`);
}

try {
  // 1. PUT via Cloudflare REST API
  const putUrl = `${objectsBase}/${encodeKey(testKey)}`;
  const putResponse = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "text/plain",
    },
    body: testBody,
  });
  if (!putResponse.ok) {
    const errBody = await putResponse.text();
    throw new Error(
      `PUT returned ${putResponse.status} ${putResponse.statusText}: ${errBody.slice(0, 300)}`,
    );
  }
  console.log(
    `✓ PUT succeeded — wrote ${testBody.length} bytes to ${bucket}/${testKey}`,
  );

  // 2. GET via public URL — verifies the bucket's public-development-URL toggle
  const publicHttpUrl = `${publicUrl}/${testKey}`;
  const response = await fetch(publicHttpUrl);
  if (response.ok) {
    const text = await response.text();
    if (text === testBody) {
      console.log(`✓ GET via public URL succeeded — ${publicHttpUrl}`);
    } else {
      console.log(
        `⚠ GET succeeded but body mismatch (got ${text.length} chars, expected ${testBody.length})`,
      );
    }
  } else {
    console.log(
      `⚠ GET via public URL returned ${response.status} ${response.statusText}`,
    );
    console.log(
      `  Public Development URL toggle may not be on yet — but PUT worked, so credentials are valid.`,
    );
    console.log(
      `  Fix: R2 dashboard → ${bucket} → Settings → Public Development URL → Enable`,
    );
  }

  // 3. DELETE — clean up the smoke-test object
  const delResponse = await fetch(putUrl, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!delResponse.ok) {
    const errBody = await delResponse.text();
    throw new Error(
      `DELETE returned ${delResponse.status} ${delResponse.statusText}: ${errBody.slice(0, 300)}`,
    );
  }
  console.log(`✓ DELETE succeeded — cleaned up ${testKey}`);

  console.log(`\nR2 credentials are working. You're set for the pilot.`);
} catch (err) {
  console.error(`\n✗ R2 operation failed: ${err.message}`);
  if (/401|403|unauthor/i.test(err.message)) {
    console.error(
      `  → Auth failed. Check R2_API_TOKEN is the cfat_... value from the rolled token dialog.`,
    );
    console.error(
      `  → Also check the token scope: Object Read & Write, bucket="${bucket}", no IP filter.`,
    );
  } else if (/404/.test(err.message)) {
    console.error(
      `  → 404. Check R2_BUCKET="${bucket}" exists in this account (R2_ACCOUNT_ID=${accountId}).`,
    );
  } else if (err.message?.includes("ENOTFOUND") || err.message?.includes("getaddrinfo")) {
    console.error(`  → DNS resolution failed. Check internet connectivity.`);
  }
  process.exit(1);
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}
