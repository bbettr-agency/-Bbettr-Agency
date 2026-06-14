import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment received" };

/**
 * Public PayFast return page (client lands here after paying). Payment status is
 * confirmed by the agency (V1: manually; V2: ITN), so this is a friendly
 * acknowledgement only.
 */
export default function PayfastReturnPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="max-w-md rounded-2xl border border-ink-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
          ✓
        </div>
        <h1 className="text-lg font-semibold text-ink-900">Thank you</h1>
        <p className="mt-2 text-sm text-ink-600">
          Your payment has been submitted to PayFast. The Bbettr Agency team will
          confirm it shortly — you don&rsquo;t need to do anything further.
        </p>
      </div>
    </main>
  );
}
