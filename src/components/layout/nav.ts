import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardList,
  FolderOpen,
  Megaphone,
  BarChart3,
  Route,
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

/** Client portal navigation. */
export const CLIENT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Onboarding", href: "/dashboard/onboarding", icon: ClipboardList },
  { label: "Project Progress", href: "/dashboard/project", icon: Route },
  { label: "Updates", href: "/dashboard/updates", icon: Megaphone },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3 },
  { label: "Files", href: "/dashboard/files", icon: FolderOpen },
  { label: "Contracts", href: "/dashboard/contracts", icon: FileSignature },
  { label: "Invoices", href: "/dashboard/invoices", icon: Receipt },
];

/** Sales-rep navigation. */
export const REP_NAV: NavItem[] = [
  { label: "Dashboard", href: "/rep", icon: LayoutDashboard },
  { label: "My Deals", href: "/rep/deals", icon: Handshake },
  { label: "New Deal", href: "/rep/deals/new", icon: ClipboardList },
  { label: "My Earnings", href: "/rep/earnings", icon: Wallet },
];

/** Admin operating-system navigation — top group. */
const ADMIN_MAIN: NavSection = {
  items: [
    { label: "Overview", href: "/admin", icon: LayoutDashboard },
    { label: "Clients", href: "/admin/clients", icon: Users },
    { label: "Reps", href: "/admin/reps", icon: Headset },
    { label: "Invoice Requests", href: "/admin/invoices", icon: Receipt },
    { label: "Reports", href: "/admin/reports", icon: BarChart3 },
    { label: "Updates", href: "/admin/updates", icon: Megaphone },
    { label: "Files", href: "/admin/files", icon: FolderOpen },
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

/** Client / rep sidebars are a single unlabeled group each. */
export const CLIENT_SECTIONS: NavSection[] = [{ items: CLIENT_NAV }];
export const REP_SECTIONS: NavSection[] = [{ items: REP_NAV }];

/** Hrefs that must match the path EXACTLY (they are prefixes of child routes). */
export const EXACT_NAV_HREFS = new Set([
  "/dashboard",
  "/admin",
  "/rep",
  "/admin/planner",
]);
