import "server-only";
import { getIntegrationConfig } from "../integration-config";
import { OPENROUTER_URL, buildAuthHeaders } from "../llm/config";

const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
const MAX_PROMPT_LENGTH = 16_000;
const FETCH_TIMEOUT_MS = 25_000;

export type AspectRatio =
  | "1:1" | "2:3" | "3:2" | "3:4" | "4:3"
  | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";

export type ImageSize = "0.5K" | "1K" | "2K" | "4K";

export interface GenerateImageOptions {
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
}

export interface GenerateImageResult {
  imageUrl: string;
  text: string | null;
  model: string;
}

export class ImageGenError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}

function sanitizePrompt(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function parseImageFromResponse(body: unknown): {
  imageUrl: string | null;
  text: string | null;
} {
  const parsed = body as {
    choices?: Array<{
      message?: {
        content?: string | Array<Record<string, unknown>>;
        images?: Array<{ image_url?: { url?: string } }>;
      };
    }>;
  };

  const message = parsed?.choices?.[0]?.message;
  if (!message) return { imageUrl: null, text: null };

  // Path 1: images[] field (Gemini models)
  const images = message.images;
  if (images && images.length > 0) {
    const url = images[0]?.image_url?.url;
    if (url) return { imageUrl: url, text: null };
  }

  const content = message.content;

  // Path 2: multimodal array content
  if (Array.isArray(content)) {
    let imageUrl: string | null = null;
    const textParts: string[] = [];

    for (const part of content) {
      if (part.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
      } else if (
        part.type === "image_url" &&
        typeof (part.image_url as Record<string, unknown>)?.url === "string"
      ) {
        imageUrl = (part.image_url as Record<string, string>).url;
      } else if ((part as Record<string, unknown>).inline_data) {
        const inline = (part as Record<string, Record<string, string>>)
          .inline_data;
        const mime = inline.mime_type || "image/png";
        imageUrl = `data:${mime};base64,${inline.data}`;
      }
    }

    return {
      imageUrl,
      text: textParts.length > 0 ? textParts.join("\n") : null,
    };
  }

  // Path 3: string content with base64 data URL
  if (typeof content === "string") {
    const dataUrlMatch = content.match(
      /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/,
    );
    if (dataUrlMatch) return { imageUrl: dataUrlMatch[0], text: null };
    return { imageUrl: null, text: content || null };
  }

  return { imageUrl: null, text: null };
}

export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const trimmed = sanitizePrompt(prompt).trim();
  if (!trimmed) {
    throw new ImageGenError("Prompt cannot be empty.", 400);
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new ImageGenError(
      `Prompt exceeds ${MAX_PROMPT_LENGTH} characters.`,
      400,
    );
  }

  const config = await getIntegrationConfig();
  const apiKey = config.llmApiKey;
  if (!apiKey) {
    throw new ImageGenError(
      "LLM API key not configured. Set OPENROUTER_API_KEY in env or configure via /admin/integrations.",
      502,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model: IMAGE_MODEL,
        messages: [{ role: "user", content: trimmed }],
        modalities: ["image", "text"],
        image_config: {
          aspect_ratio: options?.aspectRatio ?? "2:3",
          image_size: options?.imageSize ?? "2K",
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ImageGenError(
        "Image generation timed out. Try a shorter prompt.",
        504,
      );
    }
    throw new ImageGenError("AI service unavailable.", 502);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new ImageGenError("Too many requests. Try again in a moment.", 429);
    }
    if (response.status === 402) {
      throw new ImageGenError("AI service temporarily unavailable.", 502);
    }
    let errorMsg = "Image generation failed.";
    try {
      const errBody = (await response.json()) as {
        error?: { message?: string };
      };
      if (errBody?.error?.message) {
        errorMsg = errBody.error.message;
      }
    } catch {
      // keep default
    }
    throw new ImageGenError(errorMsg, response.status >= 500 ? 502 : 422);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ImageGenError("Invalid response from image model.", 502);
  }

  const { imageUrl, text } = parseImageFromResponse(body);

  if (!imageUrl) {
    throw new ImageGenError(
      "No image generated. Try rephrasing your prompt.",
      422,
    );
  }

  return { imageUrl, text, model: IMAGE_MODEL };
}
