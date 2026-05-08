import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/contact", label: "Contact" },
  { href: "/ai-readiness-assessment", label: "AI Readiness Assessment" },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-x-5 text-sm text-muted sm:gap-x-7">
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="transition-colors duration-150 hover:text-fg"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
