import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, Megaphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * "What is Bbettr doing?" — the single latest curated update, presented clearly
 * (CX2). This is a `updates` row only; project/system history (activity_events)
 * is deliberately NOT a competing Home feed. Full history stays one click away
 * on Updates. When there's no update yet we show an intentional, reassuring
 * empty state rather than a blank or a fabricated post.
 */
export interface LatestUpdateView {
  title: string;
  body: string;
  published_at: string;
  author_name: string | null;
}

export function LatestUpdate({ update }: { update: LatestUpdateView | null }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4.5 w-4.5 text-brand-500" />
          <CardTitle>Latest from Bbettr</CardTitle>
        </div>
        {update && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/updates">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {update ? (
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-400">
              <span>{format(new Date(update.published_at), "d MMMM yyyy")}</span>
              {update.author_name && (
                <>
                  <span aria-hidden>·</span>
                  <span>{update.author_name}</span>
                </>
              )}
            </div>
            <h3 className="mt-1 break-words text-base font-semibold text-ink-900">
              {update.title}
            </h3>
            <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-ink-600">
              {update.body}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-500">
              <Megaphone className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-ink-900">
              Your first update is on the way
            </p>
            <p className="max-w-sm text-xs text-ink-400">
              We’ll post here as work happens — you’ll always find the latest news
              about your project in this spot.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
