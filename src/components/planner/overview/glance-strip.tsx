import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlanceTone = "success" | "danger" | "warning" | "neutral";

/** A single at-a-glance fact. Use `icon` for a mono glyph, otherwise a tone dot. */
export interface GlanceItem {
  text: string;
  tone?: GlanceTone;
  icon?: LucideIcon;
}

const dotTone: Record<GlanceTone, string> = {
  success: "bg-emerald-500",
  danger: "bg-red-500",
  warning: "bg-amber-500",
  neutral: "bg-ink-300",
};

/**
 * A subtle single-row operational snapshot below the KPIs — not cards, not a
 * dashboard. Renders nothing when there is nothing to say.
 */
export function GlanceStrip({ items }: { items: GlanceItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-100 bg-ink-50/40 px-4 py-2.5 text-sm text-ink-600">
      {items.map((item, i) => {
        const Icon = item.icon;
        return (
          <span key={i} className="inline-flex items-center gap-2">
            {Icon ? (
              <Icon className="h-4 w-4 text-ink-400" />
            ) : (
              <span className={cn("h-2 w-2 shrink-0 rounded-full", dotTone[item.tone ?? "neutral"])} />
            )}
            <span>{item.text}</span>
          </span>
        );
      })}
    </div>
  );
}
