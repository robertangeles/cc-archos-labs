import { getIntegrationConfig } from "@/lib/integration-config";
import { getUserBrain, getBrainToken } from "./provision";
import { callMcp } from "./client";

// Best-effort wake-up for a user's GBrain so the first message's recall is
// fast instead of paying a cold-start tax mid-send. Called fire-and-forget
// from the workspace on mount. Two things go cold on Render: the OAuth token
// endpoint and the vector-query engine — so we warm both (fetch+cache the
// token, then run a throwaway query). Never throws; warming is optional.
const WARM_QUERY_TIMEOUT_MS = 9000;

export async function warmBrain(userId: string): Promise<void> {
  try {
    const config = await getIntegrationConfig();
    if (!config.gbrainUrl || !config.gbrainAdminToken) return;

    const brain = await getUserBrain(userId);
    if (!brain) return;

    const token = await getBrainToken(userId);
    if (!token) return;

    // Throwaway query — result discarded; this just warms the engine.
    await callMcp(token, "query", { query: "warm", limit: 1 }, WARM_QUERY_TIMEOUT_MS);
  } catch {
    // Warming is best-effort. A failure here just means the first real
    // recall pays the cold-start cost (now covered by the wider timeout).
  }
}
