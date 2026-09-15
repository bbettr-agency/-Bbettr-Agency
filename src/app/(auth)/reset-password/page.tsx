import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Set new password" };
export const dynamic = "force-dynamic";

/**
 * Only renders the new-password form when a valid recovery session exists (set
 * server-side by /auth/confirm). If the link was invalid / expired / already used
 * / missing params, there is no session and we show a clear recovery state with a
 * path to request a fresh link — instead of letting the update fail vaguely.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh px-6 py-12">
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        {user ? (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
              Set a new password
            </h1>
            <p className="mt-2 text-sm text-ink-500">
              Choose a strong password for your portal account.
            </p>
            <div className="mt-8">
              <ResetPasswordForm />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This password-reset link is invalid or has expired. Reset links can
                only be used once and time out for your security.
              </span>
            </div>
            <div className="mt-6">
              <Button asChild size="lg" className="w-full">
                <Link href="/forgot-password">Request a new reset link</Link>
              </Button>
            </div>
            <p className="mt-4 text-center text-sm text-ink-500">
              <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
