import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-canvas print:hidden">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-y-4 px-6 py-8 text-sm text-ink-subtle md:flex-row md:items-center md:justify-between md:gap-y-0 md:px-12">
        <p className="flex items-center gap-x-2 font-semibold text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/logo.png"
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0"
          />
          Archos Labs
        </p>
        <div className="flex items-center gap-x-6">
          <Link
            href="/privacy"
            className="transition-colors duration-150 hover:text-ink"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="transition-colors duration-150 hover:text-ink"
          >
            Terms
          </Link>
          <p>&copy; {new Date().getFullYear()} Archos Labs</p>
        </div>
      </div>
    </footer>
  );
}
