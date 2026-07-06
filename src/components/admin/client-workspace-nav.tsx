"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Home,
  ClipboardList,
  ClipboardCheck,
  Route,
  FileSignature,
  Megaphone,
  BarChart3,
  FolderOpen,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-workspace navigation (v1.6 Phase B).
 *
 * One catalog of sections drives both presentations:
 *   - WorkspaceRail  — grouped vertical rail on xl+ screens
 *   - WorkspacePills — sticky horizontal pill bar below xl
 *
 * The active section lives in the URL (?section=…) so it survives reloads,
 * deep-links and back/forward — but switching uses window.history.pushState
 * (shallow, supported natively by the App Router since Next 14.1), so it never
 * re-fetches the page. Switching stays exactly as instant as the old tabs.
 */

export type SectionId =
  | "overview"
  | "intake"
  | "onboarding"
  | "progress"
  | "contracts"
  | "updates"
  | "reports"
  | "files"
  | "billing";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: LucideIcon;
}

interface SectionGroup {
  label: string | null;
  items: SectionDef[];
}

/** Grouped catalog — order and grouping are the information architecture. */
const GROUPS: SectionGroup[] = [
  { label: null, items: [{ id: "overview", label: "Overview", icon: Home }] },
  {
    label: "Lifecycle",
    items: [
      { id: "intake", label: "Intake", icon: ClipboardList },
      { id: "onboarding", label: "Onboarding", icon: ClipboardCheck },
      { id: "progress", label: "Progress", icon: Route },
    ],
  },
  {
    label: "Money",
    items: [{ id: "billing", label: "Billing", icon: Wallet }],
  },
  {
    label: "Communication",
    items: [
      { id: "updates", label: "Updates", icon: Megaphone },
      { id: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Documents",
    items: [
      { id: "contracts", label: "Contracts", icon: FileSignature },
      { id: "files", label: "Files", icon: FolderOpen },
    ],
  },
];

const SECTION_IDS = GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** Optional per-section count badges (e.g. invoices, files). */
export type SectionCounts = Partial<Record<SectionId, number>>;

/**
 * The active section, read from ?section= (invalid/absent → overview), plus a
 * navigate function that updates the URL shallowly — pushState means the
 * browser back button walks section history, GitHub-style, with zero refetch.
 */
export function useWorkspaceSection(): [SectionId, (id: SectionId) => void] {
  const searchParams = useSearchParams();
  const raw = searchParams.get("section");
  const active: SectionId = SECTION_IDS.includes(raw as SectionId)
    ? (raw as SectionId)
    : "overview";

  const navigate = useCallback((id: SectionId) => {
    const url = new URL(window.location.href);
    if (id === "overview") url.searchParams.delete("section");
    else url.searchParams.set("section", id);
    window.history.pushState(null, "", url.toString());
  }, []);

  return [active, navigate];
}

function CountBadge({ count, active }: { count?: number; active: boolean }) {
  if (count === undefined || count === 0) return null;
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        active ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500"
      )}
    >
      {count}
    </span>
  );
}

/** Grouped vertical rail — xl+ screens. */
export function WorkspaceRail({
  active,
  counts,
  onNavigate,
}: {
  active: SectionId;
  counts: SectionCounts;
  onNavigate: (id: SectionId) => void;
}) {
  return (
    <nav aria-label="Client sections" className="space-y-1">
      {GROUPS.map((group, gi) => (
        <div key={group.label ?? gi}>
          {group.label && (
            <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {group.label}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = active === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-brand-600" : "text-ink-400"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  <CountBadge count={counts[item.id]} active={isActive} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Sticky horizontal pill bar — below xl (laptops, tablets, phones). */
export function WorkspacePills({
  active,
  counts,
  onNavigate,
}: {
  active: SectionId;
  counts: SectionCounts;
  onNavigate: (id: SectionId) => void;
}) {
  return (
    <nav
      aria-label="Client sections"
      className="flex gap-1.5 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {GROUPS.flatMap((g) => g.items).map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-300"
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
            <CountBadge count={counts[item.id]} active={isActive} />
          </button>
        );
      })}
    </nav>
  );
}
