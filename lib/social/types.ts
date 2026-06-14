export const SOCIAL_PLATFORMS = ["twitter", "linkedin", "bluesky"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export interface SocialOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  accountId: string;
  accountName: string;
}

export interface PlatformPublishContent {
  content: string;
}

export interface PublishRequest {
  platforms: Partial<Record<SocialPlatform, PlatformPublishContent>>;
}

export interface PlatformPublishResult {
  platform: SocialPlatform;
  status: "success" | "error" | "reconnect_required";
  publishedUrl?: string;
  error?: string;
}

export interface PublishResult {
  results: PlatformPublishResult[];
}

export const PLATFORM_CHAR_LIMITS: Record<SocialPlatform, number> = {
  twitter: 280,
  linkedin: 3000,
  bluesky: 300,
};

export const PLATFORM_MAX_CHAR_LIMITS: Record<SocialPlatform, number> = {
  twitter: 25_000,
  linkedin: 3000,
  bluesky: 300,
};

export const PLATFORM_DISPLAY_NAMES: Record<SocialPlatform, string> = {
  twitter: "Twitter / X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

export const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
