import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Set new password" };

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh px-6 py-12">
      <div className="w-full max-w-sm">
        <Logo className="mb-8" />
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
          Set a new password
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Choose a strong password for your portal account.
        </p>
        <div className="mt-8">
          <ResetPasswordForm />
        </div>
      </div>
    </div>
  );
}
