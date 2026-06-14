import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment cancelled" };

/** Public PayFast cancel page (client returns here if they abandon checkout). */
export default function PayfastCancelPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
          !
        </div>
        <h1 className="text-lg font-semibold text-ink-900">Payment cancelled</h1>
        <p className="mt-2 text-sm text-ink-600">
          Your payment wasn&rsquo;t completed. You can reopen the payment link to
          try again, or contact Bbettr Agency if you need help.
        </p>
      </div>
    </main>
  );
}
