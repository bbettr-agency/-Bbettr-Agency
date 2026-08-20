"use client";

import { useState } from "react";
import { FolderOpen, FileSignature, BarChart3, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractManager } from "@/components/admin/contract-manager";
import { FileManager } from "@/components/files/file-manager";
import { ReportComposer } from "@/components/admin/report-composer";
import { ReportCard } from "@/components/reports/report-card";
import { DOC_TABS, type DocTab } from "./client-workspace-sections";
import type { ContractView } from "@/lib/queries";
import type { FileRecord, Report } from "@/lib/database.types";

/**
 * Documents — ONE organised destination (IA Slice 1). Contracts / Files /
 * Reports used to be three separate workspace sections; here they become three
 * tabs of a single segmented control instead of a long vertical dump, so the
 * admin picks a category rather than scrolling past all three. Every legacy
 * manager/action is preserved verbatim inside its tab. Counts on each tab give
 * an at-a-glance sense of what lives where without opening it.
 */

const TABS: { id: DocTab; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "contracts", label: "Contracts", icon: FileSignature },
  { id: "reports", label: "Reports", icon: BarChart3 },
];

export function ClientDocumentsSection({
  clientId,
  contracts,
  files,
  reports,
}: {
  clientId: string;
  contracts: ContractView[];
  files: FileRecord[];
  reports: Report[];
}) {
  const [tab, setTab] = useState<DocTab>(DOC_TABS[0]);

  const counts: Record<DocTab, number> = {
    files: files.length,
    contracts: contracts.length,
    reports: reports.length,
  };

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Documents"
        className="inline-flex flex-wrap gap-1 rounded-xl border border-ink-200 bg-ink-50 p-1"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-800"
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {counts[t.id] > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                    isActive ? "bg-brand-100 text-brand-700" : "bg-ink-200 text-ink-500"
                  )}
                >
                  {counts[t.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "files" && (
        <FileManager clientId={clientId} initialFiles={files} isAdmin />
      )}

      {tab === "contracts" && (
        <Card>
          <CardHeader>
            <CardTitle>Contracts</CardTitle>
          </CardHeader>
          <CardContent>
            <ContractManager clientId={clientId} contracts={contracts} />
          </CardContent>
        </Card>
      )}

      {tab === "reports" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Create / update a monthly report</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportComposer clientId={clientId} />
            </CardContent>
          </Card>
          {reports.length > 0 && (
            <div className="grid gap-6 xl:grid-cols-2">
              {reports.map((r) => (
                <ReportCard key={r.id} report={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
