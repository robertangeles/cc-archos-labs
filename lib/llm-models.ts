export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic", description: "Best balance of speed and intelligence. Strong at coding, analysis, and writing.", inputCost: 3, outputCost: 15 },
  { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", description: "Fastest and cheapest. Good for simple tasks, classification, and high-volume work.", inputCost: 0.8, outputCost: 4 },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic", description: "Most capable. Best for complex reasoning, research, and multi-step tasks.", inputCost: 15, outputCost: 75 },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI", description: "OpenAI flagship. Strong at general tasks, coding, and multimodal input.", inputCost: 2.5, outputCost: 10 },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI", description: "Lightweight and fast. Good for simple generation and cost-sensitive workloads.", inputCost: 0.15, outputCost: 0.6 },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google", description: "Google's fast model. Strong at summarisation and large context windows.", inputCost: 0.15, outputCost: 0.6 },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", provider: "Meta", description: "Open-source. Good for tasks where data privacy matters.", inputCost: 0.4, outputCost: 0.4 },
  { id: "mistralai/mistral-large", name: "Mistral Large", provider: "Mistral", description: "European AI. Strong at multilingual tasks and structured output.", inputCost: 2, outputCost: 6 },
  { id: "deepseek/deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek", description: "Cost-effective. Strong at coding and reasoning tasks.", inputCost: 0.27, outputCost: 1.1 },
] as const;

export type LlmModelEntry = (typeof OPENROUTER_MODELS)[number];
