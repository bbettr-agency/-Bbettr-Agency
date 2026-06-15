"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClientAction } from "@/app/(admin)/admin/actions";
import { SERVICE_LIST } from "@/lib/services";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp } from "@/components/ui/input";

export function NewClientForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [onboardingType, setOnboardingType] = useState<"legacy" | "new">("legacy");

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createClientAction(formData);
      if (res.error && !res.ok) {
        setError(res.error);
        return;
      }
      if (res.error && res.ok) {
        // Created but with a non-fatal warning (e.g. login provisioning).
        setError(res.error);
      }
      if (res.clientId) router.push(`/admin/clients/${res.clientId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <input type="hidden" name="onboarding_type" value={onboardingType} />

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-ink-900">
            Client Onboarding Type
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  key: "legacy" as const,
                  title: "Legacy Client",
                  desc: "Already working with us — immediate portal access.",
                },
                {
                  key: "new" as const,
                  title: "New Client",
                  desc: "Follows the full intake process; access granted after the intake milestones.",
                },
              ]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setOnboardingType(opt.key)}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  onboardingType === opt.key
                    ? "border-brand-400 bg-brand-50/50 ring-1 ring-brand-200"
                    : "border-ink-200 hover:border-brand-300"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border",
                      onboardingType === opt.key
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-ink-300"
                    )}
                  >
                    {onboardingType === opt.key && <Check className="h-3 w-3" />}
                  </span>
                  {opt.title}
                </span>
                <span className="mt-1 block text-xs text-ink-500">{opt.desc}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-6">
          <h2 className="text-sm font-semibold text-ink-900">Client details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name" required>
                Business / Client Name
              </Label>
              <Input id="name" name="name" required placeholder="Botha Family Practice" />
            </div>
            <div>
              <Label htmlFor="contact_name">Contact Name</Label>
              <Input id="contact_name" name="contact_name" placeholder="Dr PM Botha" />
            </div>
            <div>
              <Label htmlFor="contact_phone">Contact Phone</Label>
              <Input id="contact_phone" name="contact_phone" placeholder="+27 82 000 0000" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              Services purchased
            </h2>
            <p className="text-sm text-ink-500">
              The client will only see onboarding for the services you select.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SERVICE_LIST.map((s) => {
              const checked = selected.includes(s.id);
              return (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-all",
                    checked
                      ? "border-brand-300 bg-brand-50 shadow-sm"
                      : "border-ink-200 hover:border-ink-300"
                  )}
                >
                  <input
                    type="checkbox"
                    name="services"
                    value={s.id}
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="sr-only"
                  />
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                      s.accent
                    )}
                  >
                    <s.icon className="h-4.5 w-4.5" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-semibold text-ink-900">
                      {s.name}
                    </span>
                    <span className="block text-xs text-ink-400">{s.tagline}</span>
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-md border",
                      checked
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-ink-300"
                    )}
                  >
                    {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5 p-6">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Portal login</h2>
            <p className="text-sm text-ink-500">
              Create the client&apos;s login. Share these credentials securely.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact_email" required>
                Login Email
              </Label>
              <Input
                id="contact_email"
                name="contact_email"
                type="email"
                required
                placeholder="client@company.com"
              />
            </div>
            {onboardingType === "legacy" ? (
              <div>
                <Label htmlFor="password">Temporary Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="text"
                  placeholder="At least 8 characters"
                  minLength={8}
                />
                <FieldHelp>
                  Leave blank to create the client without a login for now.
                </FieldHelp>
              </div>
            ) : (
              <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-3 text-xs text-ink-500">
                Portal access for new clients is granted later from the{" "}
                <strong>Intake</strong> panel, once the intake milestones are
                complete (Grant Portal Access sends the welcome email).
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Create client
        </Button>
      </div>
    </form>
  );
}
