import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavBar } from "../components/NavBar";

export const metadata: Metadata = {
  title: "NightShift — Morning verification queue",
  description: "AI insurance verification for the dental front desk",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavBar />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
