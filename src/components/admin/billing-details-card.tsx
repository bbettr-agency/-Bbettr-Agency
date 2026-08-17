"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { BillingDetailsForm } from "@/components/billing/billing-details-form";
import { adminSaveBillingDetailsAction } from "@/lib/billing-details-actions";
import {
  toBillingInput,
  resolveEffectiveEmail,
  type BillingDetailsView,
} from "@/lib/billing-details";

/**
 * Admin view + edit of a client's billing profile. Display is read from a
 * whitelisted view (no raw row). Edit reuses the shared form + the same
 * validation, saved via the admin action (admin RLS).
 */
export function BillingDetailsCard({
  clientId,
  initial,
  contactEmail,
}: {
  clientId: string;
  initial: BillingDetailsView | null;
  contactEmail: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const effectiveEmail = initial
    ? resolveEffectiveEmail(
        { billingEmailSameAsContact: initial.billingEmailSameAsContact, billingEmail: initial.billingEmail },
        contactEmail
      )
    : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-brand-600" /> Billing Details
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!initial ? (
          <p className="text-ink-500">No billing details on file yet.</p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="Invoice / company name" value={initial.invoiceName} />
            <Row label="Effective billing email" value={effectiveEmail} />
            <Row label="Registration number" value={initial.companyRegistrationNumber} />
            <Row label="VAT number" value={initial.vatNumber} />
            <Row label="Billing contact" value={initial.billingContactName} />
            <Row label="PO / reference" value={initial.poReference} />
            <Row label="Billing address" value={initial.billingAddress} className="sm:col-span-2" />
            <Row label="Invoice instructions" value={initial.invoiceInstructions} className="sm:col-span-2" />
            {initial.updatedAt && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-ink-400">
                  Last updated{" "}
                  {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(initial.updatedAt)
                  )}
                </dt>
              </div>
            )}
          </dl>
        )}
      </CardContent>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit billing details">
        <BillingDetailsForm
          initial={toBillingInput(initial)}
          contactEmail={contactEmail}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (input) => {
            const res = await adminSaveBillingDetailsAction(clientId, input);
            if (res.ok) router.refresh();
            return res;
          }}
        />
      </Modal>
    </Card>
  );
}

function Row({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-ink-800">
        {value && value.trim() ? value : <span className="text-ink-400">—</span>}
      </dd>
    </div>
  );
}
