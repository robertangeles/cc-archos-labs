import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/tools", label: "Tools" },
  { href: "/consulting", label: "Consulting" },
  { href: "/modelling-room", label: "Modelling Room" },
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
