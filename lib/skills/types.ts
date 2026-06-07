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
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic", description: "Best balance of speed and intelligence. Strong at coding, analysis, and writing." },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", description: "Fastest and cheapest. Good for simple tasks, classification, and high-volume work." },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic", description: "Most capable. Best for complex reasoning, research, and multi-step tasks." },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI", description: "OpenAI flagship. Strong at general tasks, coding, and multimodal input." },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", description: "Lightweight and fast. Good for simple generation and cost-sensitive workloads." },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", description: "Google's fast model. Strong at summarisation and large context windows." },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta", description: "Open-source. Good for tasks where data privacy matters." },
  { id: "mistralai/mistral-large", name: "Mistral Large", provider: "Mistral", description: "European AI. Strong at multilingual tasks and structured output." },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", description: "Cost-effective. Strong at coding and reasoning tasks." },
] as const;

export type LlmModelEntry = (typeof OPENROUTER_MODELS)[number];
