export type ChatMode = "research" | "web-search" | "generate-image" | null;

export const CHAT_MODE_CONFIG = {
  research: {
    modelId: "perplexity/sonar-deep-research" as const,
    label: "Deep Research",
    prefix: "Research: ",
    color: "text-sky-400",
    bgColor: "bg-sky-400/10",
    borderColor: "border-sky-400/30",
    webSearchTool: false,
  },
  "web-search": {
    modelId: null as string | null,
    label: "Web Search",
    prefix: "Search the web for: ",
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    borderColor: "border-emerald-400/30",
    webSearchTool: true,
  },
  "generate-image": {
    modelId: "google/gemini-3.1-flash-image-preview" as const,
    label: "Generate Image",
    prefix: "",
    color: "text-violet-400",
    bgColor: "bg-violet-400/10",
    borderColor: "border-violet-400/30",
    webSearchTool: false,
  },
} as const;
