import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { userBrain } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/booking-crypto";
import {
  registerClient,
  getAccessToken,
  type GBrainTokenResponse,
} from "./client";

// In-memory token cache: userId -> { token, expiresAt }
const tokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

export async function getUserBrain(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: userBrain.id,
      userId: userBrain.userId,
      brainClientId: userBrain.brainClientId,
      brainClientSecretEncrypted: userBrain.brainClientSecretEncrypted,
      provisionedAt: userBrain.provisionedAt,
      lastActiveAt: userBrain.lastActiveAt,
    })
    .from(userBrain)
    .where(eq(userBrain.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

export async function provisionBrain(userId: string) {
  const existing = await getUserBrain(userId);
  if (existing) return existing;

  const registration = await registerClient(userId);

  const db = getDb();
  const [inserted] = await db
    .insert(userBrain)
    .values({
      userId,
      brainClientId: registration.client_id,
      brainClientSecretEncrypted: encrypt(registration.client_secret),
    })
    .returning({
      id: userBrain.id,
      userId: userBrain.userId,
      brainClientId: userBrain.brainClientId,
      brainClientSecretEncrypted: userBrain.brainClientSecretEncrypted,
      provisionedAt: userBrain.provisionedAt,
      lastActiveAt: userBrain.lastActiveAt,
    });

  return inserted;
}

export async function getBrainToken(
  userId: string,
): Promise<string | null> {
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const brain = await getUserBrain(userId);
  if (!brain) return null;

  let tokenResponse: GBrainTokenResponse;
  try {
    const clientSecret = decrypt(brain.brainClientSecretEncrypted);
    tokenResponse = await getAccessToken(brain.brainClientId, clientSecret);
  } catch {
    tokenCache.delete(userId);
    return null;
  }

  const expiresAt = Date.now() + (tokenResponse.expires_in - 60) * 1000;
  tokenCache.set(userId, {
    token: tokenResponse.access_token,
    expiresAt,
  });

  const db = getDb();
  await db
    .update(userBrain)
    .set({ lastActiveAt: new Date(), updatedAt: new Date() })
    .where(eq(userBrain.userId, userId))
    .catch(() => {});

  return tokenResponse.access_token;
}

export async function deleteBrain(userId: string): Promise<void> {
  tokenCache.delete(userId);

  const db = getDb();
  await db.delete(userBrain).where(eq(userBrain.userId, userId));
}

export function clearTokenCache(userId: string): void {
  tokenCache.delete(userId);
}
