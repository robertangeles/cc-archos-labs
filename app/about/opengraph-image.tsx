import { ImageResponse } from "next/og";
import { getSiteSettings } from "../../lib/site-config";

// Programmatic Open Graph card for /about. Next.js serves this at
// /about/opengraph-image and the metadata API references it
// automatically. 1200x630 is the standard Twitter/Facebook/LinkedIn
// share-card size.
//
// Visual treatment mirrors the global app/opengraph-image.tsx — dark
// canvas, lavender brand dot, display-size type — but the About card
// leads with the page's anchor line ("We know the problems you cannot
// say out loud.") and closes with founder identity rather than
// site-level tagline + description. This is what gets shared when Rob
// posts the About URL on LinkedIn.

export const runtime = "nodejs";
export const alt = "About — Archos Labs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function AboutOpenGraphImage() {
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
              backgroundColor: "#5E6AD2",
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

        {/* Middle — anchor line, split into two lines manually because
            satori (used by next/og) does not always honour soft wrap on
            inline accent spans. Column flex + two complete lines keeps
            whitespace intact and lets the lavender span render inline
            within its line. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 1040,
            fontSize: 68,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.025em",
            color: "#F5F5F5",
          }}
        >
          <span>We know the problems</span>
          <span>you cannot say</span>
          <span style={{ color: "#5E6AD2" }}>out loud.</span>
        </div>

        {/* Bottom — founder identity */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 26,
              fontWeight: 500,
              color: "#F5F5F5",
              letterSpacing: "-0.005em",
            }}
          >
            {settings.founderName}
          </span>
          <span
            style={{
              fontSize: 22,
              color: "#A1A1AA",
            }}
          >
            Principal Consultant · Archos Labs
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
