"use client";

import { useState, useTransition } from "react";
import { BarChart3, CheckCircle2 } from "lucide-react";
import { upsertReportAction } from "@/app/(admin)/admin/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const NUMERIC_FIELDS: { name: string; label: string; step?: string }[] = [
  { name: "ad_spend", label: "Ad Spend (ZAR)", step: "0.01" },
  { name: "leads_generated", label: "Leads Generated" },
  { name: "cost_per_lead", label: "Cost Per Lead (ZAR)", step: "0.01" },
  { name: "clicks", label: "Clicks" },
  { name: "impressions", label: "Impressions" },
  { name: "conversion_rate", label: "Conversion Rate (%)", step: "0.01" },
];

const TEXT_FIELDS: { name: string; label: string }[] = [
  { name: "summary", label: "Summary" },
  { name: "key_wins", label: "Key Wins" },
  { name: "opportunities", label: "Opportunities" },
  { name: "next_month_plan", label: "Next Month Plan" },
];

export function ReportComposer({ clientId }: { clientId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    // Normalise the month input (YYYY-MM) to a date.
    const month = String(formData.get("reporting_month") ?? "");
    if (month && month.length === 7) formData.set("reporting_month", `${month}-01`);
    startTransition(async () => {
      const res = await upsertReportAction(formData);
      if (res.error) setError(res.error);
      else {
        form.reset();
        setDone(true);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="max-w-xs">
        <Label htmlFor="r-month" required>
          Reporting Month
        </Label>
        <Input id="r-month" name="reporting_month" type="month" required />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {NUMERIC_FIELDS.map((f) => (
          <div key={f.name}>
            <Label htmlFor={`r-${f.name}`}>{f.label}</Label>
            <Input
              id={`r-${f.name}`}
              name={f.name}
              type="number"
              step={f.step ?? "1"}
              placeholder="0"
            />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <div key={f.name}>
            <Label htmlFor={`r-${f.name}`}>{f.label}</Label>
            <Textarea id={`r-${f.name}`} name={f.name} rows={3} />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          <BarChart3 className="h-4 w-4" /> Save report
        </Button>
        {done && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Report saved
          </span>
        )}
      </div>
    </form>
  );
}
