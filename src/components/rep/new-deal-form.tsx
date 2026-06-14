"use client";

import { useState, useTransition } from "react";
import { AlertCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { createDealAction } from "@/app/(rep)/rep/actions";
import { SERVICE_PACKAGES, CUSTOM_PACKAGE_KEY } from "@/lib/packages";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select, FieldHelp } from "@/components/ui/input";

export function NewDealForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [packageKey, setPackageKey] = useState("");
  const isCustom = packageKey === CUSTOM_PACKAGE_KEY;

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
                South African clients are invoiced for EFT; international clients
                will later receive an online payment link.
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
          <h2 className="text-sm font-semibold text-ink-900">Package & price</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="package_key" required>
                Service Package
              </Label>
              <Select
                id="package_key"
                name="package_key"
                value={packageKey}
                onChange={(e) => setPackageKey(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a package…
                </option>
                {SERVICE_PACKAGES.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <FieldHelp>
                Determines the product/service and description on the invoice.
              </FieldHelp>
            </div>
            <div>
              <Label htmlFor="price" required>
                Price (ZAR)
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
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="billing_type">Billing</Label>
              <Select id="billing_type" name="billing_type" defaultValue="once_off">
                <option value="once_off">Once-off</option>
                <option value="monthly">Monthly</option>
              </Select>
              <FieldHelp>
                Monthly deals raise a first invoice; recurring billing is set up
                by the team.
              </FieldHelp>
            </div>
            {isCustom && (
              <>
                <div className="sm:col-span-2">
                  <Label htmlFor="custom_package_name" required>
                    Custom Product / Service Name
                  </Label>
                  <Input
                    id="custom_package_name"
                    name="custom_package_name"
                    placeholder="e.g. Bespoke Branding Retainer"
                    required={isCustom}
                  />
                  <FieldHelp>Shown as the product/service on the invoice.</FieldHelp>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="custom_package_description" required>
                    Custom Description
                  </Label>
                  <Textarea
                    id="custom_package_description"
                    name="custom_package_description"
                    rows={2}
                    required={isCustom}
                    placeholder="What the client is being invoiced for."
                  />
                </div>
              </>
            )}
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
