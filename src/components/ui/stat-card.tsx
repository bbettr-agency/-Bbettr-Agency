import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("p-5 transition-shadow hover:shadow-card-hover", className)}>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <span
            className={cn(
              "text-xs font-semibold",
              trend.positive ? "text-emerald-600" : "text-red-500"
            )}
          >
            {trend.value}
          </span>
        )}
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-ink-900">
        {value}
      </p>
      <p className="mt-0.5 text-sm font-medium text-ink-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </Card>
  );
}
