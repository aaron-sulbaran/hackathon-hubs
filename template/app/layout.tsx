import type { Metadata, Viewport } from "next";
import { Doto, Lexend } from "next/font/google";
import "./globals.css";

// The shell every response shares, the 404 page included, so it carries no
// team data and no event name: those live in app/(hub)/layout.tsx, behind the
// unlock cookie.

// Both faces come from Google Fonts through next/font (open licenses, served
// from this deployment). Lexend sets the text; Doto, a dot-matrix face, sets
// the departure digits.
const lexend = Lexend({ subsets: ["latin"], variable: "--font-lexend", display: "swap" });
const doto = Doto({ subsets: ["latin"], variable: "--font-doto", display: "swap", weight: ["700", "900"] });

export const metadata: Metadata = {
  title: "Team hub",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffcf8" },
    { media: "(prefers-color-scheme: dark)", color: "#1a2238" },
  ],
};

// Runs before the first paint. Entrance animations (the greeting's reveal, the
// map's swarm) start hidden, so they are allowed only when the page is visible
// and motion is welcome, and switched off after 2.4s or when the tab hides.
const ENTRANCE_GUARD = `(function(){try{var d=document.documentElement;if(document.visibilityState!=="visible"||matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.setAttribute("data-entrance","");var off=function(){d.removeAttribute("data-entrance")};setTimeout(off,2400);document.addEventListener("visibilitychange",function(){if(document.visibilityState!=="visible")off()})}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${doto.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_GUARD }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
