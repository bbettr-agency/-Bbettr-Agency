import { format } from "date-fns";
import { Megaphone } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { Update } from "@/lib/database.types";

/** Project update feed rendered as a vertical timeline. */
export function UpdatesTimeline({ updates }: { updates: Update[] }) {
  return (
    <div className="relative">
      <span
        className="absolute left-5 top-2 h-full w-0.5 bg-ink-100"
        aria-hidden
      />
      <ul className="space-y-6">
        {updates.map((u) => (
          <li key={u.id} className="relative flex gap-4">
            <span className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500 ring-4 ring-white">
              <Megaphone className="h-4.5 w-4.5" />
            </span>
            <div className="flex-1 rounded-2xl border border-ink-100 bg-white p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">
                  {u.title}
                </h3>
                <time className="text-xs text-ink-400">
                  {format(new Date(u.published_at), "d MMMM yyyy")}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {u.body}
              </p>
              {u.author_name && (
                <div className="mt-4 flex items-center gap-2 border-t border-ink-100 pt-3">
                  <Avatar name={u.author_name} size="sm" />
                  <span className="text-xs font-medium text-ink-500">
                    {u.author_name}
                  </span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
