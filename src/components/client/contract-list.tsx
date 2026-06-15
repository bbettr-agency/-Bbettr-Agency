"use client";

import { useState } from "react";
import { format } from "date-fns";
import { FileSignature, ExternalLink, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSignedUrl } from "@/lib/upload";
import { Card } from "@/components/ui/card";
import type { ContractView } from "@/lib/queries";

const STATUS_STYLES: Record<string, string> = {
  not_sent: "bg-ink-100 text-ink-600",
  sent: "bg-amber-50 text-amber-700",
  signed: "bg-emerald-50 text-emerald-700",
};
const STATUS_LABELS: Record<string, string> = {
  not_sent: "Awaiting",
  sent: "Awaiting signature",
  signed: "Signed",
};

/** Client-facing contract list: view the agreement, download the signed copy. */
export function ContractList({ contracts }: { contracts: ContractView[] }) {
  const [error, setError] = useState<string | null>(null);

  async function download(path: string) {
    try {
      const url = await getSignedUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the file.");
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      {contracts.map((c) => (
        <Card key={c.id} className="flex flex-wrap items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
            <FileSignature className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900">{c.title}</p>
            <p className="text-xs text-ink-400">
              {c.signed_at
                ? `Signed ${format(new Date(c.signed_at), "d MMM yyyy")}`
                : c.sent_at
                  ? `Sent ${format(new Date(c.sent_at), "d MMM yyyy")}`
                  : "Being prepared"}
            </p>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[c.status] ?? "bg-ink-100 text-ink-600"
            )}
          >
            {STATUS_LABELS[c.status] ?? c.status}
          </span>
          {c.contract_url && (
            <a
              href={c.contract_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View
            </a>
          )}
          {c.signedFile && (
            <button
              onClick={() => download(c.signedFile!.path)}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Download className="h-3.5 w-3.5" /> Signed copy
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
