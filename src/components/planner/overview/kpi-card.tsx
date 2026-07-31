import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export type KpiTone = "default" | "success" | "warning" | "danger";

const chipTone: Record<KpiTone, string> = {
  default: "bg-brand-50 text-brand-500",
  success: "bg-emerald-50 text-emerald-600",
  warning: "bg-amber-50 text-amber-600",
  danger: "bg-red-100 text-red-600",
};

/**
 * Overview KPI card — same visual language as StatCard, with a headline value, a
 * secondary line, and a tone so a failure/attention state reads at a glance
 * without needing the subtitle.
 */
export function KpiCard({
  label,
  value,
  secondary,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  secondary?: string;
  icon: LucideIcon;
  tone?: KpiTone;
}) {
  return (
    <Card
      className={cn(
        "p-5 transition-shadow hover:shadow-card-hover",
        tone === "danger" && "border-red-200 bg-red-50"
      )}
    >
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", chipTone[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <p
        className={cn(
          "mt-4 text-2xl font-bold tracking-tight",
          tone === "danger" ? "text-red-600" : "text-ink-900"
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-sm font-medium text-ink-500">{label}</p>
      {secondary && <p className="mt-1 text-xs text-ink-400">{secondary}</p>}
    </Card>
  );
}
