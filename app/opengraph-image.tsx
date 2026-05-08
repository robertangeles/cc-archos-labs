import { ImageResponse } from "next/og";
import { getSiteSettings } from "../lib/site-config";

// Programmatic Open Graph card. Next.js serves this at /opengraph-image
// (resolved automatically by the metadata API and referenced from
// site-config defaults). 1200x630 is the standard Twitter/Facebook/
// LinkedIn share-card size. Re-renders whenever the admin updates the
// site_setting row — no design tool involved.

export const runtime = "nodejs";
export const alt = "Archos Labs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const settings = await getSiteSettings();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#0F0F0F",
          color: "#F5F5F5",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Top — brand mark + site name */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: "#3B82F6",
            }}
          />
          <span
            style={{
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {settings.siteName}
          </span>
        </div>

        {/* Bottom — tagline + description */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            maxWidth: 1000,
          }}
        >
          <span
            style={{
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#F5F5F5",
            }}
          >
            {settings.tagline}
          </span>
          <span
            style={{
              fontSize: 26,
              lineHeight: 1.4,
              color: "#A1A1AA",
            }}
          >
            {settings.description.length > 200
              ? settings.description.slice(0, 197) + "…"
              : settings.description}
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
