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
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Client portal navigation. */
export const CLIENT_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Onboarding", href: "/dashboard/onboarding", icon: ClipboardList },
  { label: "Project Progress", href: "/dashboard/project", icon: Route },
  { label: "Updates", href: "/dashboard/updates", icon: Megaphone },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3 },
  { label: "Files", href: "/dashboard/files", icon: FolderOpen },
];

/** Admin operating-system navigation. */
export const ADMIN_NAV: NavItem[] = [
  { label: "Overview", href: "/admin", icon: LayoutDashboard },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Invoice Requests", href: "/admin/invoices", icon: Receipt },
  { label: "Reports", href: "/admin/reports", icon: BarChart3 },
  { label: "Updates", href: "/admin/updates", icon: Megaphone },
  { label: "Files", href: "/admin/files", icon: FolderOpen },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/** Sales-rep navigation. */
export const REP_NAV: NavItem[] = [
  { label: "My Deals", href: "/rep", icon: Handshake },
  { label: "New Deal", href: "/rep/deals/new", icon: ClipboardList },
];
