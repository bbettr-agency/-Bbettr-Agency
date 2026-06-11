import { ShieldOff } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * Branded full-screen notice shown to a sales rep whose account has been
 * deactivated by an admin. Rendered by the rep layout in place of the portal so
 * an inactive rep can't view or act in the rep portal. Includes a sign-out link
 * so they're never trapped.
 */
export function RepDisabledScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mesh px-6 text-center">
      <div className="w-full max-w-md rounded-3xl border border-ink-100 bg-white/80 p-10 shadow-card backdrop-blur-xl">
        <Logo className="mb-8 justify-center" />
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
          <ShieldOff className="h-7 w-7" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
          Account Deactivated
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-500">
          Your sales rep account has been deactivated. Please contact your
          administrator if you believe this is a mistake.
        </p>

        <form action="/auth/signout" method="post" className="mt-8">
          <button
            type="submit"
            className="text-sm font-medium text-brand-600 transition-colors hover:text-brand-700"
          >
            Sign out
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs text-ink-400">
        © {new Date().getFullYear()} Bbettr Agency
      </p>
    </div>
  );
}
