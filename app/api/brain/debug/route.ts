import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getIntegrationConfig } from "@/lib/integration-config";
import { getUserBrain, getBrainToken } from "@/lib/brain/provision";
import { recallMemories } from "@/lib/brain/recall";
import { extractMemories } from "@/lib/brain/extract";
import { callMcp } from "@/lib/brain/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "what is the user name";
  const action = searchParams.get("action");

  const steps: Record<string, unknown> = {};

  try {
    const config = await getIntegrationConfig();
    steps.gbrainUrl = config.gbrainUrl;
    steps.gbrainAdminTokenPresent = !!config.gbrainAdminToken;
  } catch (e) {
    steps.configError = e instanceof Error ? e.message : String(e);
  }

  const brain = await getUserBrain(auth.user.id);
  steps.brainProvisioned = !!brain;
  steps.brainClientId = brain?.brainClientId ?? null;

  let token: string | null = null;
  if (brain) {
    try {
      token = await getBrainToken(auth.user.id);
      steps.tokenObtained = !!token;
    } catch (e) {
      steps.tokenError = e instanceof Error ? e.message : String(e);
    }
  }

  if (action === "extract" && token) {
    try {
      await extractMemories(auth.user.id, "Test user message", "Test assistant response");
      steps.extractResult = "completed";
    } catch (e) {
      steps.extractError = e instanceof Error ? e.message : String(e);
    }
  }

  if (action === "store" && token) {
    try {
      const resp = await callMcp(token, "put_page", {
        slug: `sessions/debug-${Date.now()}`,
        content: "---\ntitle: Debug test\n---\n\nMy name is Rob Angeles from Bundoora VIC.",
      }, 10000);
      steps.storeResult = resp.error ? resp.error : "stored";
    } catch (e) {
      steps.storeError = e instanceof Error ? e.message : String(e);
    }
  }

  if (action === "list" && token) {
    try {
      const resp = await callMcp(token, "list_pages", { limit: 20 }, 10000);
      steps.listResult = resp.error ? resp.error : resp.result;
    } catch (e) {
      steps.listError = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const recall = await recallMemories(auth.user.id, query);
    steps.recallSource = recall.source;
    steps.recallCount = recall.count;
    steps.recallMemories = recall.memories.map((m) => m.slice(0, 100));

    if (action === "prompt" && recall.memories.length > 0) {
      const { formatRecallContext } = await import("@/lib/brain/recall");
      const { getChatPrompt } = await import("@/lib/chat/prompt-config");
      const brainContext = formatRecallContext(recall.memories);
      const corePrompt = (await getChatPrompt()).systemPrompt;
      steps.assembledPromptPreview = (corePrompt.slice(0, 200) + "...").replace(/\n/g, " ");
      steps.hasBrainMemoryInPrompt = corePrompt.includes("BRAIN MEMORY");
      steps.brainContextPreview = brainContext.slice(0, 200);
      steps.promptOrder = "corePrompt → brainBridge → brainContext";
    }
  } catch (e) {
    steps.recallError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(steps);
}
