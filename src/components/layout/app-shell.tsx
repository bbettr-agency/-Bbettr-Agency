"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CLIENT_NAV, ADMIN_NAV, type NavItem } from "@/components/layout/nav";

interface AppShellProps {
  user: { name: string; email: string; avatarUrl?: string | null };
  /** Label shown under the user (e.g. tenant name or "Administrator"). */
  context: string;
  roleLabel: "Client" | "Admin";
  children: React.ReactNode;
}

export function AppShell({
  user,
  context,
  roleLabel,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Select the navigation inside the client bundle. The nav items contain
  // Lucide icon components (functions), which cannot be serialized across the
  // server→client boundary — so they must NOT be passed in as a prop.
  const nav: NavItem[] = roleLabel === "Admin" ? ADMIN_NAV : CLIENT_NAV;

  const isActive = (href: string) =>
    href === pathname ||
    (href !== "/dashboard" && href !== "/admin" && pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-100 bg-white lg:flex">
        <SidebarInner
          nav={nav}
          user={user}
          context={context}
          roleLabel={roleLabel}
          isActive={isActive}
        />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-ink-100 bg-white/80 px-4 backdrop-blur-lg lg:hidden">
        <Logo />
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-card-hover animate-scale-in">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-2 text-ink-500 hover:bg-ink-100"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarInner
              nav={nav}
              user={user}
              context={context}
              roleLabel={roleLabel}
              isActive={isActive}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarInner({
  nav,
  user,
  context,
  roleLabel,
  isActive,
  onNavigate,
}: {
  nav: NavItem[];
  user: AppShellProps["user"];
  context: string;
  roleLabel: "Client" | "Admin";
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-16 items-center px-6">
        <Logo />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {nav.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
              )}
            >
              <item.icon
                className={cn(
                  "h-4.5 w-4.5 shrink-0",
                  active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-ink-100 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <Avatar name={user.name} src={user.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-ink-900">
                {user.name}
              </p>
              <Badge tone={roleLabel === "Admin" ? "brand" : "neutral"} className="px-1.5 py-0">
                {roleLabel}
              </Badge>
            </div>
            <p className="truncate text-xs text-ink-400">{context}</p>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="h-4.5 w-4.5 text-ink-400" />
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}
