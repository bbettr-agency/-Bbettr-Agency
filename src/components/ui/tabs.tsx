"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  children,
}: {
  items: TabItem[];
  children: (active: string) => React.ReactNode;
}) {
  const [active, setActive] = useState(items[0]?.id);

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-ink-100">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={cn(
              "relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
              active === item.id
                ? "text-brand-700"
                : "text-ink-500 hover:text-ink-800"
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-0.5 text-xs",
                  active === item.id
                    ? "bg-brand-100 text-brand-700"
                    : "bg-ink-100 text-ink-500"
                )}
              >
                {item.count}
              </span>
            )}
            {active === item.id && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />
            )}
          </button>
        ))}
      </div>
      <div className="pt-6">{children(active)}</div>
    </div>
  );
}
