import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-mesh px-6 text-center">
      <Logo className="mb-8" />
      <p className="font-display text-6xl font-extrabold text-brand-500">404</p>
      <h1 className="mt-4 text-xl font-bold text-ink-900">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-500">
        The page you&apos;re looking for doesn&apos;t exist or you don&apos;t have
        access to it.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to your portal</Link>
      </Button>
    </div>
  );
}
