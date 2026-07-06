import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the client workspace: sticky header bar + rail + content. */
export default function ClientDetailLoading() {
  return (
    <div>
      {/* Client header bar */}
      <div className="flex min-h-14 items-center gap-3 border-b border-ink-100 py-2">
        <Skeleton className="h-4 w-14" /> {/* Clients / */}
        <Skeleton className="h-8 w-8 rounded-full" /> {/* avatar */}
        <Skeleton className="h-5 w-44" /> {/* name */}
        <Skeleton className="h-5 w-20 rounded-full" /> {/* status */}
      </div>

      <div className="pt-6 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
        {/* Rail (xl+) */}
        <aside className="hidden space-y-2 xl:block">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </aside>

        {/* Pills (below xl) + content */}
        <div className="min-w-0 space-y-6">
          <div className="flex gap-2 xl:hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
