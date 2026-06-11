"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { XIcon, LinkedinIcon, BlueskyIcon } from "@/components/icons/social";
import type { SocialPlatform } from "@/lib/social/types";
import { PLATFORM_DISPLAY_NAMES } from "@/lib/social/types";

interface ConnectedAccount {
  id: string;
  platform: string;
  accountIdentifier: string;
  isConnected: boolean;
}

const PLATFORM_ICONS: Record<SocialPlatform, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  twitter: XIcon,
  linkedin: LinkedinIcon,
  bluesky: BlueskyIcon,
};

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  twitter: "border-neutral-700",
  linkedin: "border-blue-700",
  bluesky: "border-sky-600",
};

export function SocialAccountsPage() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const initialOauthMessage = useMemo(() => {
    const oauth = searchParams.get("oauth");
    const platform = searchParams.get("platform");
    if (oauth && platform) {
      return {
        type: (oauth === "success" ? "success" : "error") as "success" | "error",
        platform,
        reason: searchParams.get("reason") ?? undefined,
      };
    }
    return null;
  }, [searchParams]);
  const [oauthMessage, setOauthMessage] = useState(initialOauthMessage);
  const [blueskyForm, setBlueskyForm] = useState({ handle: "", appPassword: "" });
  const [blueskyConnecting, setBlueskyConnecting] = useState(false);
  const [blueskyError, setBlueskyError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const responses = await Promise.all(
        (["twitter", "linkedin", "bluesky"] as SocialPlatform[]).map(
          async (platform) => {
            const res = await fetch(`/api/social/${platform}/status`);
            if (!res.ok) return { platform, connected: false };
            const data = await res.json();
            return { platform, ...data };
          },
        ),
      );
      setAccounts(
        responses
          .filter((r) => r.connected)
          .map((r) => ({
            id: r.platform,
            platform: r.platform,
            accountIdentifier: r.accountName ?? r.platform,
            isConnected: true,
          })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    if (oauthMessage) {
      const timer = setTimeout(() => setOauthMessage(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [oauthMessage]);

  const handleDisconnect = async (platform: SocialPlatform) => {
    if (disconnecting) return;
    if (!window.confirm(`Disconnect ${PLATFORM_DISPLAY_NAMES[platform]}?`)) {
      return;
    }
    setDisconnecting(platform);
    try {
      const res = await fetch(`/api/social/${platform}/disconnect`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Disconnect failed.");
      }
      await fetchAccounts();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setDisconnecting(null);
    }
  };

  const handleBlueskyConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (blueskyConnecting) return;
    setBlueskyConnecting(true);
    setBlueskyError(null);
    try {
      const res = await fetch("/api/social/bluesky/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: blueskyForm.handle,
          appPassword: blueskyForm.appPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlueskyError(data.error ?? "Connection failed.");
        return;
      }
      setBlueskyForm({ handle: "", appPassword: "" });
      await fetchAccounts();
    } catch {
      setBlueskyError("Network error. Try again.");
    } finally {
      setBlueskyConnecting(false);
    }
  };

  const isConnected = (platform: SocialPlatform) =>
    accounts.some((a) => a.platform === platform && a.isConnected);

  const getAccountName = (platform: SocialPlatform) =>
    accounts.find((a) => a.platform === platform)?.accountIdentifier;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-hairline bg-surface-1/30"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-subtle">
        Connect your social media accounts to publish content directly from
        Workflows.
      </p>

      {oauthMessage && (
        <div
          className={`rounded-md border p-3 text-sm ${
            oauthMessage.type === "success"
              ? "border-green-700/40 bg-green-950/20 text-green-400"
              : "border-red-700/40 bg-red-950/20 text-red-400"
          }`}
        >
          {oauthMessage.type === "success"
            ? `${PLATFORM_DISPLAY_NAMES[oauthMessage.platform as SocialPlatform] ?? oauthMessage.platform} connected successfully.`
            : `Failed to connect ${PLATFORM_DISPLAY_NAMES[oauthMessage.platform as SocialPlatform] ?? oauthMessage.platform}${oauthMessage.reason ? `: ${oauthMessage.reason}` : "."}`}
        </div>
      )}

      {(["twitter", "linkedin", "bluesky"] as SocialPlatform[]).map(
        (platform) => {
          const Icon = PLATFORM_ICONS[platform];
          const connected = isConnected(platform);
          const accountName = getAccountName(platform);

          return (
            <div
              key={platform}
              className={`rounded-lg border ${PLATFORM_COLORS[platform]} bg-surface-1/30 p-5`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2">
                    <Icon className="h-5 w-5 text-ink" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {PLATFORM_DISPLAY_NAMES[platform]}
                    </p>
                    {connected && accountName && (
                      <p className="text-xs text-ink-subtle">{accountName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {connected ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
                        Connected
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDisconnect(platform)}
                        disabled={disconnecting === platform}
                        className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink-subtle transition-colors hover:bg-surface-1 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {disconnecting === platform
                          ? "Disconnecting..."
                          : "Disconnect"}
                      </button>
                    </>
                  ) : platform !== "bluesky" ? (
                    <a
                      href={`/api/social/${platform}/connect`}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
                    >
                      Connect
                    </a>
                  ) : null}
                </div>
              </div>

              {platform === "bluesky" && !connected && (
                <form
                  onSubmit={handleBlueskyConnect}
                  className="mt-4 space-y-3 border-t border-hairline pt-4"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="Handle (e.g. you.bsky.social)"
                      value={blueskyForm.handle}
                      onChange={(e) =>
                        setBlueskyForm((f) => ({
                          ...f,
                          handle: e.target.value,
                        }))
                      }
                      className="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/50 focus:border-primary focus:outline-none"
                    />
                    <input
                      type="password"
                      placeholder="App password"
                      value={blueskyForm.appPassword}
                      onChange={(e) =>
                        setBlueskyForm((f) => ({
                          ...f,
                          appPassword: e.target.value,
                        }))
                      }
                      className="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-subtle/50 focus:border-primary focus:outline-none"
                    />
                  </div>
                  {blueskyError && (
                    <p className="text-xs text-red-400">{blueskyError}</p>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={
                        blueskyConnecting ||
                        !blueskyForm.handle ||
                        !blueskyForm.appPassword
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {blueskyConnecting ? "Connecting..." : "Connect"}
                    </button>
                    <p className="text-xs text-ink-subtle">
                      Create an app password at bsky.app/settings/app-passwords
                    </p>
                  </div>
                </form>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}
