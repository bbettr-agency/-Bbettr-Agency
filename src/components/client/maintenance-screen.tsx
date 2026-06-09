import { Wrench } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/**
 * Branded full-screen maintenance notice shown to clients when an admin has
 * enabled maintenance mode. Includes a sign-out link so a client is never
 * trapped.
 */
export function MaintenanceScreen({ message }: { message?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mesh px-6 text-center">
      <div className="w-full max-w-md rounded-3xl border border-ink-100 bg-white/80 p-10 shadow-card backdrop-blur-xl">
        <Logo className="mb-8 justify-center" />
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          <Wrench className="h-7 w-7" />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
          Maintenance in Progress
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-500">
          {message ??
            "We're currently making improvements to your client portal. Please check back shortly."}
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
