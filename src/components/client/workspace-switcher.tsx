"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildWorkspaceMenu,
  safeSwitchReturnPath,
  type WorkspaceOption,
} from "@/lib/active-workspace";
import { setActiveWorkspaceAction } from "@/app/(client)/workspace-actions";

/**
 * Client Workspace Switcher (Membership S4B). Shown only to a client who belongs
 * to more than one Bbettr workspace. It makes the ACTIVE workspace obvious at a
 * glance and lets the user switch with one click. Switching calls the secure S3
 * setActiveWorkspaceAction, which re-validates membership server-side — the
 * cookie/label here can never widen access (S2 RLS remains authoritative).
 */
export function WorkspaceSwitcher({
  activeId,
  workspaces,
}: {
  activeId: string;
  workspaces: WorkspaceOption[];
}) {
  const pathname = usePathname();
  const { activeName, options } = buildWorkspaceMenu(activeId, workspaces);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
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

  function select(id: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setSwitchingTo(id);
    startTransition(async () => {
      // The action re-validates membership, sets the cookie, and (with a safe
      // return path) redirects — re-rendering the whole portal in the new
      // workspace. A rejected switch simply leaves us where we are.
      await setActiveWorkspaceAction(id, safeSwitchReturnPath(pathname));
      setSwitchingTo(null);
      setOpen(false);
    });
  }

  return (
    <div ref={ref} className="relative px-3 pt-3">
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        Workspace
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Current workspace: ${activeName ?? "workspace"}. Switch workspace`}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-left transition-colors",
          "hover:border-brand-300 hover:bg-brand-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
          pending && "opacity-60"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Building2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-900">
            {activeName ?? "Select workspace"}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-400" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          className="absolute left-3 right-3 z-40 mt-1 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-card-hover"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            Workspaces
          </p>
          {options.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitemradio"
              aria-checked={w.isActive}
              disabled={pending}
              onClick={() => select(w.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                w.isActive ? "font-semibold text-ink-900" : "text-ink-700 hover:bg-ink-50",
                pending && switchingTo === w.id && "opacity-60"
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-brand-600">
                {w.isActive && <Check className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
