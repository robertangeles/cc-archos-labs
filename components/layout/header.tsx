"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "./nav";

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-150 ${
        scrolled
          ? "border-b border-rule bg-canvas/80 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-[1080px] flex-col items-start gap-y-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-0 md:px-12">
        <Link
          href="/"
          className="flex items-center gap-x-2.5 text-base font-semibold tracking-tight text-fg"
          aria-label="Archos Labs — home"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logo.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0"
          />
          Archos Labs
        </Link>
        <Nav />
      </div>
    </header>
  );
}
