import type { Metadata } from "next";
import { Source_Serif_4, Inter } from "next/font/google";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Archos Labs — Built by practitioners",
  description:
    "AI transformation practice and product studio. Senior data architecture and AI integration consulting for programs that can't afford to get it wrong.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">
        {children}
      </body>
    </html>
  );
}
