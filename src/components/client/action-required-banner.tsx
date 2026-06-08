"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveActionItemAction } from "@/app/(client)/dashboard/actions";

interface ActionItem {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

export function ActionRequiredBanner({ items }: { items: ActionItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return null;

  function markDone(id: string) {
    setBusyId(id);
    startTransition(async () => {
      await resolveActionItemAction(id);
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <Card className="border-amber-300 bg-amber-50/60">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white">
            <AlertTriangle className="h-4.5 w-4.5" />
          </span>
          <h2 className="text-sm font-semibold text-ink-900">
            Action required ({items.length})
          </h2>
        </div>
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">
                  {item.title}
                </p>
                {item.body && (
                  <p className="mt-0.5 text-sm text-ink-500">{item.body}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.link && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={item.link}>
                      Open <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
                <Button
                  size="sm"
                  loading={pending && busyId === item.id}
                  disabled={pending}
                  onClick={() => markDone(item.id)}
                >
                  <Check className="h-4 w-4" /> Mark done
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
