import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { WatermarkRemoverClient } from "./watermark-remover-client";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Watermark Remover",
    description:
      "Strip invisible AI provenance signals from text and photos before you send them — entirely in your browser. Nothing is ever uploaded.",
    path: "/tools/watermark-remover",
  });
}

export default function WatermarkRemoverPage() {
  return <WatermarkRemoverClient />;
}
