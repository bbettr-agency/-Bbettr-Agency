import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";
import { Sparkles, ShieldCheck, BarChart3 } from "lucide-react";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — form */}
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[46%] lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-900">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Sign in to access your Bbettr Agency client portal.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="mt-8 text-center text-xs text-ink-400">
            Need access? Contact your Bbettr Agency account manager.
          </p>
        </div>
      </div>

      {/* Right — brand panel */}
      <div className="relative hidden flex-1 overflow-hidden bg-ink-900 lg:block">
        <div className="bg-mesh absolute inset-0 opacity-30" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 10%, rgba(56,182,255,0.35), transparent 60%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-16">
          <Logo variant="light" />

          <div className="max-w-md">
            <h2 className="font-display text-3xl font-bold leading-tight text-white">
              Your campaigns, projects and results — all in one premium portal.
            </h2>
            <ul className="mt-8 space-y-4">
              {[
                { icon: Sparkles, text: "Dynamic onboarding tailored to your services" },
                { icon: BarChart3, text: "Beautiful monthly performance reports" },
                { icon: ShieldCheck, text: "Secure, private and built for scale" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-brand-50">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-brand-300">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="text-sm text-white/80">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} Bbettr Agency. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
