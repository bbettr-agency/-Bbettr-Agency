import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A single rule-based briefing/insight line (computed server-side). */
export interface BriefingItem {
  text: string;
  href?: string;
  tone?: "default" | "warning" | "success";
}

const dotTone: Record<NonNullable<BriefingItem["tone"]>, string> = {
  default: "bg-brand-400",
  warning: "bg-amber-500",
  success: "bg-emerald-500",
};

/** Calm, scannable list of short operational statements. Renders nothing if empty. */
export function BriefingList({ items }: { items: BriefingItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => {
        const body = (
          <div className="flex items-center gap-3">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotTone[item.tone ?? "default"])} />
            <span className="flex-1 text-sm text-ink-700">{item.text}</span>
            {item.href && <ChevronRight className="h-4 w-4 shrink-0 text-ink-300" />}
          </div>
        );
        return (
          <li key={i}>
            {item.href ? (
              <Link href={item.href} className="-mx-2 block rounded-lg px-2 py-1.5 transition-colors hover:bg-ink-50">
                {body}
              </Link>
            ) : (
              <div className="px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
