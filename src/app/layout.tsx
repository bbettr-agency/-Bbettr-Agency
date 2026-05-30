import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Bbettr Agency Portal",
    template: "%s · Bbettr Agency",
  },
  description:
    "The premium client portal and operating system for Bbettr Agency — onboarding, project progress, reports and updates in one place.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.bbettragency.com"
  ),
};

export const viewport: Viewport = {
  themeColor: "#38B6FF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
