import { format } from "date-fns";
import {
  Wallet,
  Users,
  Target,
  MousePointerClick,
  Eye,
  Percent,
  Trophy,
  Lightbulb,
  CalendarDays,
  FileText,
} from "lucide-react";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { Report } from "@/lib/database.types";

const metrics = (r: Report) => [
  { label: "Ad Spend", value: formatCurrency(r.ad_spend), icon: Wallet },
  { label: "Leads", value: formatNumber(r.leads_generated), icon: Users },
  { label: "Cost / Lead", value: formatCurrency(r.cost_per_lead), icon: Target },
  { label: "Clicks", value: formatNumber(r.clicks), icon: MousePointerClick },
  { label: "Impressions", value: formatNumber(r.impressions), icon: Eye },
  {
    label: "Conv. Rate",
    value: formatPercent(r.conversion_rate),
    icon: Percent,
  },
];

/**
 * Premium monthly report card. Used on both the client Reports page and the
 * admin reports view.
 */
export function ReportCard({
  report,
  pdfUrl,
}: {
  report: Report;
  pdfUrl?: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="relative overflow-hidden bg-ink-900 p-6 text-white">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 120% at 100% 0%, rgba(56,182,255,0.4), transparent 55%)",
          }}
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-300">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Monthly Report
            </span>
          </div>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
            >
              <FileText className="h-3.5 w-3.5" /> PDF
            </a>
          )}
        </div>
        <h3 className="relative mt-2 font-display text-xl font-bold">
          {format(new Date(report.reporting_month), "MMMM yyyy")}
        </h3>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 divide-x divide-y divide-ink-100 sm:grid-cols-3">
        {metrics(report).map((m) => (
          <div key={m.label} className="p-4">
            <div className="flex items-center gap-1.5 text-ink-400">
              <m.icon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{m.label}</span>
            </div>
            <p className="mt-1 text-lg font-bold text-ink-900">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Narrative */}
      <div className="space-y-4 p-6">
        {report.summary && (
          <Section title="Summary">{report.summary}</Section>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {report.key_wins && (
            <NarrativeBlock
              icon={Trophy}
              tone="emerald"
              title="Key Wins"
              body={report.key_wins}
            />
          )}
          {report.opportunities && (
            <NarrativeBlock
              icon={Lightbulb}
              tone="amber"
              title="Opportunities"
              body={report.opportunities}
            />
          )}
        </div>
        {report.next_month_plan && (
          <NarrativeBlock
            icon={CalendarDays}
            tone="brand"
            title="Next Month Plan"
            body={report.next_month_plan}
          />
        )}
      </div>
    </Card>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        {title}
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-ink-700">{children}</p>
    </div>
  );
}

const toneStyles = {
  emerald: "border-emerald-100 bg-emerald-50/60 text-emerald-600",
  amber: "border-amber-100 bg-amber-50/60 text-amber-600",
  brand: "border-brand-100 bg-brand-50/60 text-brand-600",
};

function NarrativeBlock({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Trophy;
  tone: keyof typeof toneStyles;
  title: string;
  body: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${toneStyles[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{body}</p>
    </div>
  );
}
