"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BillingDetailsForm } from "@/components/billing/billing-details-form";
import { saveMyBillingDetailsAction } from "@/lib/billing-details-actions";
import { toBillingInput, isBillingComplete, type BillingDetailsView } from "@/lib/billing-details";

/**
 * ONE shared billing section for the whole onboarding flow (client-level, NOT
 * per-service). Prefilled from the client's single billing profile; saving
 * upserts that same row. Required before any service onboarding can be finally
 * submitted (enforced server-side in saveOnboarding).
 */
export function BillingDetailsSection({
  initial,
  contactEmail,
}: {
  initial: BillingDetailsView | null;
  contactEmail: string | null;
}) {
  const router = useRouter();
  const complete = isBillingComplete(initial, contactEmail);

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Receipt className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-bold text-ink-900">Invoice / billing details</h2>
              <p className="text-sm text-ink-500">
                Please provide the details you&rsquo;d like us to use for your invoices. We use these
                across all of your services — you only need to enter them once.
              </p>
            </div>
          </div>
          {complete ? (
            <Badge tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
            </Badge>
          ) : (
            <Badge tone="warning">Needs invoice name + billing email</Badge>
          )}
        </div>

        <BillingDetailsForm
          initial={toBillingInput(initial)}
          contactEmail={contactEmail}
          submitLabel="Save billing details"
          onSave={async (input) => {
            const res = await saveMyBillingDetailsAction(input);
            if (res.ok) router.refresh();
            return res;
          }}
        />
      </CardContent>
    </Card>
  );
}
