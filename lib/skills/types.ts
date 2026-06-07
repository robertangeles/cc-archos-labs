export type SkillCategory =
  | "repurpose"
  | "generate"
  | "research"
  | "transform"
  | "extract"
  | "plan";

export const SKILL_CATEGORIES: SkillCategory[] = [
  "repurpose",
  "generate",
  "research",
  "transform",
  "extract",
  "plan",
];

export type SkillInputType = "text" | "multiline" | "select";

export type SkillOutputType = "text" | "markdown" | "json";

export interface SkillInputDef {
  key: string;
  type: SkillInputType;
  label: string;
  description?: string;
  required: boolean;
  defaultValue?: string;
  options?: string[];
}

export interface SkillOutputDef {
  key: string;
  type: SkillOutputType;
  label: string;
  description?: string;
}

export interface SkillVersionConfig {
  inputs: SkillInputDef[];
  outputs: SkillOutputDef[];
  promptTemplate: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  defaultModel: string;
}

export interface ExecuteSkillRequest {
  inputs: Record<string, string>;
  model?: string;
}

export interface ExecuteSkillResponse {
  result: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "anthropic/claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta" },
  { id: "mistralai/mistral-large-latest", name: "Mistral Large", provider: "Mistral" },
  { id: "deepseek/deepseek-chat-v3", name: "DeepSeek V3", provider: "DeepSeek" },
] as const;
