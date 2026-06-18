"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { createDealAction } from "@/app/(rep)/rep/actions";
import { SERVICE_PACKAGES, WEBSITE_SEO_RETAINER } from "@/lib/packages";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select, FieldHelp } from "@/components/ui/input";

export function NewDealForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [packageKey, setPackageKey] = useState("");
  const [pricingType, setPricingType] = useState<"local" | "international">("local");
  const [hasRetainer, setHasRetainer] = useState(false);

  const selectedPackage = SERVICE_PACKAGES.find((p) => p.key === packageKey);
  const currency = pricingType === "international" ? "USD" : "ZAR";
  const billingLabel = selectedPackage
    ? selectedPackage.billing === "monthly"
      ? "Monthly"
      : "Once-off"
    : "—";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createDealAction(formData);
      // On success the action redirects; only errors return here.
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="space-y-5 p-6">
          <h2 className="text-sm font-semibold text-ink-900">Client details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="business_name" required>
                Business Name
              </Label>
              <Input id="business_name" name="business_name" required />
            </div>
            <div>
              <Label htmlFor="contact_name">Contact Person</Label>
              <Input id="contact_name" name="contact_name" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="client_location" required>
                Client Location
              </Label>
              <Select
                id="client_location"
                name="client_location"
                defaultValue="south_africa"
                required
              >
                <option value="south_africa">South Africa</option>
                <option value="international">International</option>
              </Select>
              <FieldHelp>
                Affects payment routing only — South African clients are invoiced
                for EFT; international clients receive an online payment link.
                (Currency is set by Pricing Type below.)
              </FieldHelp>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-6">
          <h2 className="text-sm font-semibold text-ink-900">Service & price</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="package_key" required>
                Service
              </Label>
              <Select
                id="package_key"
                name="package_key"
                value={packageKey}
                onChange={(e) => setPackageKey(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a service…
                </option>
                {SERVICE_PACKAGES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </Select>
              {selectedPackage && (
                <div className="mt-2 rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                  <p className="text-xs font-medium text-ink-500">
                    Invoice description · {billingLabel}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">
                    {selectedPackage.description}
                  </p>
                </div>
              )}
              <FieldHelp>
                The service name and description are applied to the invoice
                automatically — no need to type them.
              </FieldHelp>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="pricing_type" required>
                Pricing Type
              </Label>
              <Select
                id="pricing_type"
                name="pricing_type"
                value={pricingType}
                onChange={(e) =>
                  setPricingType(e.target.value as "local" | "international")
                }
                required
              >
                <option value="local">Local Price (ZAR)</option>
                <option value="international">International Price (USD)</option>
              </Select>
              <FieldHelp>
                Sets the invoice currency. Local = ZAR, International = USD.
              </FieldHelp>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="price" required>
                Price ({currency})
              </Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0"
              />
              <FieldHelp>Enter the amount in {currency}. No default pricing.</FieldHelp>
            </div>

            <div className="sm:col-span-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/40 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="has_monthly_retainer"
                  checked={hasRetainer}
                  onChange={(e) => setHasRetainer(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  <span className="text-sm font-medium text-ink-900">
                    Add monthly retainer?{" "}
                    <span className="font-normal text-ink-400">(optional)</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500">
                    Adds a separate monthly invoice line on top of the service above.
                  </span>
                </span>
              </label>

              {hasRetainer && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="retainer_key" required>
                      Monthly Retainer
                    </Label>
                    <Select
                      id="retainer_key"
                      name="retainer_key"
                      defaultValue={WEBSITE_SEO_RETAINER.key}
                    >
                      <option value={WEBSITE_SEO_RETAINER.key}>
                        {WEBSITE_SEO_RETAINER.name}
                      </option>
                    </Select>
                    <div className="mt-2 rounded-xl border border-ink-100 bg-white p-3">
                      <p className="text-sm text-ink-700">
                        {WEBSITE_SEO_RETAINER.description}
                      </p>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="monthly_retainer_amount" required>
                      Monthly Retainer Amount ({currency})
                    </Label>
                    <Input
                      id="monthly_retainer_amount"
                      name="monthly_retainer_amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required={hasRetainer}
                      placeholder="0"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className={cn("flex justify-end")}>
        <Button type="submit" loading={pending}>
          <Send className="h-4 w-4" /> Create deal & request invoice
        </Button>
      </div>
    </form>
  );
}
