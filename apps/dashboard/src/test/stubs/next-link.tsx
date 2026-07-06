import * as React from "react";

// Minimal stand-in for next/link in unit tests (renders a plain anchor).
export default function Link({
  href,
  children,
  ...rest
}: {
  href: string;
  children: React.ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
