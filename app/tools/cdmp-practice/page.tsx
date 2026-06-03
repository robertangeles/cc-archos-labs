import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/site-config";
import { Exam } from "./exam";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "CDMP Practice Exam",
    description:
      "Free practice exam for the CDMP Fundamentals certification. 100 questions, 5 choices, 90 minutes — mirrors the real DAMA exam format. See your strengths and weaknesses by DMBOK chapter.",
    path: "/tools/cdmp-practice",
  });
}

export default function CdmpPracticePage() {
  return <Exam />;
}
