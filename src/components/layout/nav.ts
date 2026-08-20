import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  FolderOpen,
  Megaphone,
  BarChart3,
  Users,
  Settings,
  Handshake,
  Receipt,
  Headset,
  Wallet,
  Plug,
  FileSignature,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Sun,
  ListChecks,
  UsersRound,
  CalendarCheck,
  Repeat,
  Inbox,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * A navigation group. An optional `label` turns it into a titled sub-menu (e.g.
 * "Planner") whose items render indented; groups are separated by dividers.
 */
export interface NavSection {
  label?: string;
  icon?: LucideIcon;
  items: NavItem[];
}

/**
 * Client portal navigation (IA Slice 1). Primary destinations are Home,
 * Onboarding (only while onboarding is still relevant), and Updates. Reports /
 * Invoices / Contracts / Files are consolidated under a subordinate
 * "Documents & billing" group so they stop competing for top-level attention —
 * every route is preserved. Project Progress is removed from primary nav (the
 * roadmap is the Home surface; the /dashboard/project route stays as the
 * expanded-roadmap target and is still reachable via Home + notifications).
 */
const CLIENT_DOCUMENTS: NavItem[] = [
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3 },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
  { label: "Contracts", href: "/dashboard/contracts", icon: FileSignature },
  { label: "Files", href: "/dashboard/files", icon: FolderOpen },
];

/** Build the client sidebar. Onboarding appears only while it's still relevant. */
export function clientNavSections(opts: { onboardingActive: boolean }): NavSection[] {
  const primary: NavItem[] = [{ label: "Home", href: "/dashboard", icon: LayoutDashboard }];
  if (opts.onboardingActive) {
    primary.push({ label: "Onboarding", href: "/dashboard/onboarding", icon: ClipboardList });
  }
  primary.push({ label: "Updates", href: "/dashboard/updates", icon: Megaphone });
  return [
    { items: primary },
    { label: "Documents & billing", icon: FolderOpen, items: CLIENT_DOCUMENTS },
  ];
}

/** Sales-rep navigation. */
export const REP_NAV: NavItem[] = [
  { label: "Dashboard", href: "/rep", icon: LayoutDashboard },
  { label: "My Deals", href: "/rep/deals", icon: Handshake },
  { label: "New Deal", href: "/rep/deals/new", icon: ClipboardList },
  { label: "My Earnings", href: "/rep/earnings", icon: Wallet },
];

/**
 * Admin operating-system navigation — top group. The agency-wide Reports /
 * Updates / Files pages are read-only roll-ups of the same data the per-client
 * sections author, so they are demoted OUT of primary nav (routes preserved and
 * still resolve for bookmarks); the /admin Overview already previews recents.
 */
const ADMIN_MAIN: NavSection = {
  items: [
    { label: "Overview", href: "/admin", icon: LayoutDashboard },
    { label: "Clients", href: "/admin/clients", icon: Users },
    { label: "Reps", href: "/admin/reps", icon: Headset },
    { label: "Invoice Requests", href: "/admin/invoices", icon: Receipt },
  ],
};

/**
 * Bbettr OS Planner (internal, admin-only). Rendered as a titled sub-menu, only
 * when PLANNER_ENABLED is on. Never shown to clients or reps.
 */
export const PLANNER_SECTION: NavSection = {
  label: "Planner",
  icon: CalendarClock,
  items: [
    { label: "Overview", href: "/admin/planner", icon: LayoutDashboard },
    { label: "Today", href: "/admin/planner/today", icon: Sun },
    { label: "This Week", href: "/admin/planner/week", icon: CalendarRange },
    { label: "Calendar", href: "/admin/planner/meetings", icon: CalendarDays },
    { label: "My Tasks", href: "/admin/planner/tasks", icon: ListChecks },
    { label: "Team View", href: "/admin/planner/team", icon: UsersRound },
    { label: "Weekly Updates", href: "/admin/planner/weekly-updates", icon: CalendarCheck },
    { label: "Recurring Reminders", href: "/admin/planner/recurrences", icon: Repeat },
    { label: "Inbox", href: "/admin/planner/inbox", icon: Inbox },
  ],
};

/** Admin navigation — bottom group. */
const ADMIN_TAIL: NavSection = {
  items: [
    { label: "Integrations", href: "/admin/integrations", icon: Plug },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
};

/**
 * Compose the admin sidebar. The Planner sub-menu sits between the main group
 * and Integrations/Settings, and is included only when the module is enabled.
 */
export function adminNavSections(plannerEnabled: boolean): NavSection[] {
  return plannerEnabled
    ? [ADMIN_MAIN, PLANNER_SECTION, ADMIN_TAIL]
    : [ADMIN_MAIN, ADMIN_TAIL];
}

/** Default client sidebar (onboarding shown). The layout passes the live flag. */
export const CLIENT_SECTIONS: NavSection[] = clientNavSections({ onboardingActive: true });
/** Rep sidebar is a single unlabeled group. */
export const REP_SECTIONS: NavSection[] = [{ items: REP_NAV }];

/** Hrefs that must match the path EXACTLY (they are prefixes of child routes). */
export const EXACT_NAV_HREFS = new Set([
  "/dashboard",
  "/admin",
  "/rep",
  "/admin/planner",
]);
