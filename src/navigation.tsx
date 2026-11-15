import type { ReactNode } from "react";

export type Route = "home" | "explorer" | "documentary" | "about";

const LINKS: { route: Route; label: string; href: string }[] = [
  { route: "home", label: "Home", href: "#home" },
  { route: "explorer", label: "Global Explorer", href: "#explorer" },
  { route: "documentary", label: "Documentary", href: "#documentary" },
  { route: "about", label: "About ASTROMATCH", href: "#about" },
];

export function SiteNavigation({
  current,
  onNavigate,
  className = "",
}: {
  current: Route;
  onNavigate: (route: Route) => void;
  className?: string;
}): ReactNode {
  return (
    <nav className={`site-nav ${className}`} aria-label="Main navigation">
      {LINKS.map(({ route, label, href }) => (
        <a
          key={route}
          href={href}
          className={current === route ? "is-current" : ""}
          aria-current={current === route ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(route);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
