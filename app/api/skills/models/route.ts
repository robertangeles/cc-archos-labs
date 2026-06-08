import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getIntegrationConfig } from "@/lib/integration-config";
import { OPENROUTER_MODELS } from "@/lib/skills/types";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getCurrentUser();
  if (!auth) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const config = await getIntegrationConfig();
    const enabled = new Set(config.llmEnabledModels);
    const builtIn = OPENROUTER_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      description: m.description,
      inputCost: m.inputCost,
      outputCost: m.outputCost,
    }));
    const custom = (config.llmCustomModels ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      description: m.description ?? "Custom model",
    }));
    const all = [...builtIn, ...custom];
    const models = all.filter((m) => enabled.has(m.id));
    return NextResponse.json({ models, defaultModel: config.llmModelId ?? null });
  } catch {
    return NextResponse.json(
      { error: "Failed to load model configuration." },
      { status: 500 },
    );
  }
}
