"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, FieldHelp } from "@/components/ui/input";
import {
  validateBillingDraft,
  isValidEmail,
  type BillingDetailsInput,
} from "@/lib/billing-details";
import type { BillingSaveResult } from "@/lib/billing-details-actions";

/**
 * Shared client-level billing form (0055). Used by the onboarding billing
 * section and the admin edit modal — one form, one validation, one
 * "same as contact" behaviour. Required: Invoice/Company name + an effective
 * billing email. Everything else is clearly optional.
 */
export function BillingDetailsForm({
  initial,
  contactEmail,
  onSave,
  submitLabel = "Save billing details",
  onCancel,
}: {
  initial: BillingDetailsInput;
  contactEmail: string | null;
  onSave: (input: BillingDetailsInput) => Promise<BillingSaveResult>;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const canUseContact = Boolean(contactEmail && isValidEmail(contactEmail));
  // If there's no valid account email, "same as contact" can't apply.
  const [form, setForm] = useState<BillingDetailsInput>({
    ...initial,
    billing_email_same_as_contact: canUseContact ? initial.billing_email_same_as_contact : false,
  });
  const [errors, setErrors] = useState<BillingSaveResult["fieldErrors"]>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof BillingDetailsInput>(key: K, value: BillingDetailsInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSaved(false);
    setGeneral(null);
  }

  function submit() {
    setGeneral(null);
    setSaved(false);
    // DRAFT validation — partial profiles are allowed to save; only malformed
    // supplied values block. Completeness is enforced at the onboarding submit
    // gate, not here. The server re-validates the same way.
    const v = validateBillingDraft(form);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    startTransition(async () => {
      const res = await onSave(form);
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        setGeneral(res.error);
      } else {
        setErrors({});
        setSaved(true);
        onCancel?.(); // close the modal on success when embedded in one
      }
    });
  }

  const useContact = form.billing_email_same_as_contact;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="bd-name" required>Invoice / company name</Label>
        <Input id="bd-name" value={form.invoice_name} maxLength={200}
          onChange={(e) => set("invoice_name", e.target.value)}
          placeholder="The name to appear on your invoices" />
        <FieldError msg={errors?.invoice_name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bd-reg">Company registration number</Label>
          <Input id="bd-reg" value={form.company_registration_number} maxLength={50}
            onChange={(e) => set("company_registration_number", e.target.value)} />
          <FieldHelp>Optional — leave blank if not a registered company.</FieldHelp>
          <FieldError msg={errors?.company_registration_number} />
        </div>
        <div>
          <Label htmlFor="bd-vat">VAT number</Label>
          <Input id="bd-vat" value={form.vat_number} maxLength={30}
            onChange={(e) => set("vat_number", e.target.value)} />
          <FieldHelp>Optional — leave blank if not VAT registered.</FieldHelp>
          <FieldError msg={errors?.vat_number} />
        </div>
      </div>

      {/* Same-as-contact */}
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={useContact} disabled={!canUseContact}
          onChange={(e) => set("billing_email_same_as_contact", e.target.checked)}
          className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-400 disabled:opacity-50" />
        Use my account/contact email for billing
      </label>
      {!canUseContact && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          There&rsquo;s no valid account email on file — please enter a billing email below.
        </p>
      )}

      {useContact ? (
        <div>
          <Label>Billing email</Label>
          <p className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-700">
            {contactEmail}
          </p>
          <FieldHelp>Using your account email. Uncheck above to use a different address.</FieldHelp>
        </div>
      ) : (
        <div>
          <Label htmlFor="bd-email" required>Billing email</Label>
          <Input id="bd-email" type="email" value={form.billing_email} maxLength={254}
            onChange={(e) => set("billing_email", e.target.value)}
            placeholder="accounts@yourcompany.com" />
          <FieldError msg={errors?.billing_email} />
        </div>
      )}

      <div>
        <Label htmlFor="bd-contact">Billing contact name</Label>
        <Input id="bd-contact" value={form.billing_contact_name} maxLength={200}
          onChange={(e) => set("billing_contact_name", e.target.value)} />
        <FieldHelp>Optional.</FieldHelp>
      </div>

      <div>
        <Label htmlFor="bd-address">Billing address</Label>
        <Textarea id="bd-address" value={form.billing_address} maxLength={1000} rows={3}
          onChange={(e) => set("billing_address", e.target.value)} />
        <FieldHelp>Optional.</FieldHelp>
        <FieldError msg={errors?.billing_address} />
      </div>

      <div>
        <Label htmlFor="bd-po">PO / reference requirements</Label>
        <Input id="bd-po" value={form.po_reference} maxLength={120}
          onChange={(e) => set("po_reference", e.target.value)} />
        <FieldHelp>Optional — e.g. a purchase-order number to quote on invoices.</FieldHelp>
      </div>

      <div>
        <Label htmlFor="bd-notes">Additional invoice instructions</Label>
        <Textarea id="bd-notes" value={form.invoice_instructions} maxLength={2000} rows={3}
          onChange={(e) => set("invoice_instructions", e.target.value)} />
        <FieldHelp>Optional.</FieldHelp>
        <FieldError msg={errors?.invoice_instructions} />
      </div>

      <p className="text-xs text-ink-400">
        You can save partial details now. An invoice name and billing email are
        needed before you can submit your onboarding.
      </p>

      {general && (
        <p className="flex items-start gap-1.5 text-sm text-red-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {general}
        </p>
      )}
      {saved && <p className="text-sm text-emerald-700">Billing details saved.</p>}

      <div className="flex items-center gap-3 pt-1">
        <Button onClick={submit} loading={pending} disabled={pending}>{submitLabel}</Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
        )}
      </div>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
      <AlertCircle className="h-3.5 w-3.5" /> {msg}
    </p>
  );
}
