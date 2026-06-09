"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  Handshake,
  Receipt,
  UserPlus,
  UserX,
  Wrench,
  CheckCircle2,
  XCircle,
  Wallet,
  Route,
  MessageSquare,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  markInternalReadAction,
  markAllInternalReadAction,
} from "@/lib/internal-notification-actions";
import type { InternalFeedItem } from "@/lib/internal-notifications";
import type { InternalNotificationType } from "@/lib/database.types";

const TYPE_ICON: Record<InternalNotificationType, LucideIcon> = {
  deal_submitted: Handshake,
  invoice_request: Receipt,
  rep_created: UserPlus,
  rep_deactivated: UserX,
  maintenance_toggled: Wrench,
  invoice_approved: CheckCircle2,
  invoice_rejected: XCircle,
  commission_recorded: Wallet,
  deal_status: Route,
  admin_comment: MessageSquare,
};

export function InternalNotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: InternalFeedItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openItem(item: InternalFeedItem) {
    setOpen(false);
    if (!item.read_at) startTransition(() => markInternalReadAction(item.id));
    if (item.link) router.push(item.link);
  }

  function markAll() {
    startTransition(async () => {
      await markAllInternalReadAction();
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-ink-600 transition-colors hover:bg-ink-100"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card-hover animate-scale-in">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAll}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-ink-50 text-ink-300">
                <Bell className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-ink-900">
                No new notifications
              </p>
              <p className="mt-0.5 text-xs text-ink-400">You&apos;re all caught up.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
              {notifications.map((item) => {
                const Icon = TYPE_ICON[item.type] ?? Bell;
                const unread = !item.read_at;
                return (
                  <li key={item.id}>
                    <button
                      onClick={() => openItem(item)}
                      className={cn(
                        "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50",
                        unread && "bg-brand-50/50"
                      )}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm",
                            unread ? "font-semibold text-ink-900" : "font-medium text-ink-700"
                          )}
                        >
                          {item.title}
                        </span>
                        {item.body && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-ink-500">
                            {item.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-ink-400">
                          {formatDistanceToNow(new Date(item.created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </span>
                      {unread && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
