"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget. Renders nothing when siteKey is null
// (feature off — matches the backend's default-OFF posture; the form
// still works without a token). Loads the Cloudflare script once,
// renders the widget explicitly, and reports the token via onToken.

interface TurnstileWidgetProps {
  siteKey: string | null;
  onToken: (token: string | null) => void;
}

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

// Read window.turnstile via a local cast rather than a `declare global`
// augmentation — app/book/[slug]/booking-form.tsx already augments
// Window.turnstile with a different shape, and two conflicting global
// declarations don't compile.
function getTurnstile(): TurnstileApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function ensureScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    if (getTurnstile()) return resolve();
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      // Already loaded but turnstile not yet attached — poll briefly.
      const poll = setInterval(() => {
        if (getTurnstile()) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ siteKey, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    ensureScript().then(() => {
      const turnstile = getTurnstile();
      if (cancelled || !containerRef.current || !turnstile) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    });

    return () => {
      cancelled = true;
      const turnstile = getTurnstile();
      if (widgetIdRef.current && turnstile) {
        try {
          turnstile.remove(widgetIdRef.current);
        } catch {
          // widget already gone — ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;

  return <div ref={containerRef} className="mt-1" />;
}
