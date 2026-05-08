import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Header } from "../components/layout/header";
import { Footer } from "../components/layout/footer";
import "./globals.css";

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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-fg font-sans">
        <Header />
        <div className="flex-1 flex flex-col">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
