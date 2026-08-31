import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * Shared chrome for the public legal pages (/privacy, /terms). Branded but
 * simple, and fully self-contained — it renders without any authenticated
 * context so the pages are reachable by Google's OAuth reviewers and by anyone
 * else without a portal session.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Bbettr Agency">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium text-ink-500">
            <Link href="/privacy" className="hover:text-ink-900">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ink-900">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
          Bbettr Portal
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink-900 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ink-400">Last updated {updated}</p>

        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <footer className="border-t border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-8 text-sm text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Bbettr Agency. All rights reserved.</span>
          <span>
            Questions?{" "}
            <a
              href="mailto:info@bbettragency.com"
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              info@bbettragency.com
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** A titled section within a legal page. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink-900">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
        {children}
      </div>
    </section>
  );
}
