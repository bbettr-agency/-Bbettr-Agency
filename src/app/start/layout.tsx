import type { Metadata } from "next";
import { Playfair_Display, DM_Sans } from "next/font/google";

/**
 * Public prospect-intake layout (P2). Scopes an editorial typeface pairing —
 * Playfair Display (headings) + DM Sans (body) — to the /start subtree ONLY,
 * via next/font CSS variables consumed by the `font-editorial*` Tailwind
 * utilities. The Portal/admin typography (Inter + Sora) is untouched.
 *
 * noindex: prospect intake links (generic and tokenised) must never be indexed.
 */
const editorialDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-editorial-display",
  display: "swap",
});
const editorialSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-editorial-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Get started · Bbettr Agency",
  robots: { index: false, follow: false },
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${editorialDisplay.variable} ${editorialSans.variable} font-editorial`}>
      {children}
    </div>
  );
}
