import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut, ShieldOff } from "lucide-react";
import { getCurrentProfile, homePath } from "@/lib/auth";

export const metadata: Metadata = { title: "No workspace access" };

/**
 * Stable landing for an AUTHENTICATED user who currently has no client workspace
 * (zero memberships) — a legitimate state after an admin revokes their final
 * workspace, or transiently while access is being provisioned. It deliberately
 * does NOT call requireClientWorkspace (which would bounce back here) and does
 * NOT redirect to /login (which the middleware bounces authenticated users off,
 * causing the "Too many redirects" loop). It just renders a calm message and a
 * safe Sign out. Admins/reps who somehow land here go to their own home.
 *
 * It never exposes internal IDs or errors.
 */
export default async function NoAccessPage() {
  const profile = await getCurrentProfile();
  // A signed-in admin/rep belongs on their own surface, not this client screen.
  if (profile && profile.role !== "client") redirect(homePath(profile.role));

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
          <ShieldOff className="h-6 w-6" />
        </span>
        <h1 className="mt-4 font-display text-xl font-bold text-ink-900">
          No workspace access
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Your account doesn’t currently have access to a client workspace. If you
          believe this is a mistake, please contact your Bbettr Agency team and
          we’ll sort it out right away.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-800"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
