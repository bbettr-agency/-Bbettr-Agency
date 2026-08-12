"use client";

/**
 * Minimal accessible dropdown menu — Portal design language (ink/brand tokens,
 * rounded-xl, shadow), no external library. Self-contained: manages open state,
 * outside-click + Escape close, focus return to the trigger, and roving keyboard
 * navigation (Arrow/Home/End/Enter/Space). Items are a data array so the caller
 * can render only status-legal actions.
 *
 * Mobile-safe: the panel is right-aligned by default with a bounded width, so it
 * never causes horizontal overflow at narrow widths.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

export type DropdownItem =
  | { type?: "item"; key: string; label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean }
  | { type: "separator"; key: string };

const isItem = (i: DropdownItem): i is Extract<DropdownItem, { type?: "item" }> => i.type !== "separator";

export function DropdownMenu({
  label,
  items,
  align = "end",
  disabled,
  size = "sm",
  variant = "outline",
  triggerClassName,
  triggerRef: externalTriggerRef,
  "aria-label": ariaLabel,
}: {
  label: string;
  items: DropdownItem[];
  align?: "start" | "end";
  disabled?: boolean;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  triggerClassName?: string;
  /** Optional shared ref to the trigger button (so callers can return focus to it). */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const internalTriggerRef = React.useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? internalTriggerRef;
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const actionable = items.filter(isItem);

  const close = React.useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Outside-click (pointerdown so it beats the click) + Escape.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // Focus the first enabled item when the menu opens.
  React.useEffect(() => {
    if (!open) return;
    const first = itemRefs.current.findIndex((el) => el && !el.disabled);
    if (first >= 0) itemRefs.current[first]?.focus();
  }, [open]);

  function focusByOffset(current: number, delta: number) {
    const n = actionable.length;
    for (let step = 1; step <= n; step++) {
      const idx = (current + delta * step + n * step) % n;
      const el = itemRefs.current[idx];
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
  }

  function onItemKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusByOffset(index, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusByOffset(index, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusByOffset(-1, 1);
    } else if (e.key === "End") {
      e.preventDefault();
      focusByOffset(0, -1);
    } else if (e.key === "Tab") {
      close(false); // let focus move on naturally
    }
  }

  function select(onSelect: () => void) {
    close();
    // Defer so focus-return settles before the handler may open an inline area/modal.
    setTimeout(onSelect, 0);
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <Button
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        type="button"
        size={size}
        variant={variant}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </Button>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel ?? label}
          className={cn(
            "absolute z-30 mt-1 min-w-[11rem] max-w-[16rem] overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-card-hover",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {items.map((item, i) => {
            if (!isItem(item)) {
              return <div key={item.key} role="separator" className="my-1 h-px bg-ink-100" />;
            }
            const idx = actionable.indexOf(item);
            return (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => select(item.onSelect)}
                onKeyDown={(e) => onItemKeyDown(e, idx)}
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-sm transition-colors focus:outline-none disabled:opacity-50",
                  item.destructive
                    ? "text-red-600 hover:bg-red-50 focus:bg-red-50"
                    : "text-ink-700 hover:bg-ink-50 focus:bg-ink-50"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
