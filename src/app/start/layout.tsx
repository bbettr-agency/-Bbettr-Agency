import type { Metadata } from "next";

/**
 * Public prospect-intake layout (P2). Inherits the Portal typography (Inter +
 * Sora) from the root layout so the public intake feels like a premium
 * extension of the Bbettr Portal — no separate font family.
 *
 * noindex: prospect intake links (generic and tokenised) must never be indexed.
 */
export const metadata: Metadata = {
  title: "Get started · Bbettr Agency",
  robots: { index: false, follow: false },
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
