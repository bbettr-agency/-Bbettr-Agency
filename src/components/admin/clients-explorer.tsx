"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { ProgressBar } from "@/components/ui/progress-tracker";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { ClientStatus } from "@/lib/database.types";

/**
 * Plain, serializable row for the admin clients table. Everything is computed
 * server-side (progress, service names) so this component stays purely
 * interactive — search / filter / sort happen in-browser over data already
 * loaded, with no extra queries.
 */
export interface ClientRow {
  id: string;
  name: string;
  contactEmail: string | null;
  status: ClientStatus;
  onboardingDone: number;
  onboardingTotal: number;
  progress: number;
  serviceNames: string[];
  lastUpdate: string | null;
  lastReport: string | null;
}

const STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "onboarding", label: "Onboarding" },
  { value: "in_progress", label: "In Progress" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

type OnbFilter = "all" | "complete" | "in_progress" | "not_started";
const ONB_OPTIONS: { value: OnbFilter; label: string }[] = [
  { value: "all", label: "All onboarding" },
  { value: "complete", label: "Onboarding complete" },
  { value: "in_progress", label: "Onboarding in progress" },
  { value: "not_started", label: "Onboarding not started" },
];

function onbState(r: ClientRow): Exclude<OnbFilter, "all"> {
  if (r.onboardingTotal > 0 && r.onboardingDone >= r.onboardingTotal) return "complete";
  if (r.onboardingDone > 0) return "in_progress";
  return "not_started";
}

type SortKey = "recent" | "name" | "progress" | "onboarding" | "lastUpdate";
/** Default direction the first time a column is chosen. */
const DEFAULT_DIR: Record<Exclude<SortKey, "recent">, "asc" | "desc"> = {
  name: "asc",
  progress: "desc",
  onboarding: "desc",
  lastUpdate: "desc",
};

export function ClientsExplorer({ rows }: { rows: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ClientStatus>("all");
  const [onb, setOnb] = useState<OnbFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (onb !== "all" && onbState(r) !== onb) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.contactEmail?.toLowerCase().includes(q) ?? false)
      );
    });

    if (sortKey !== "recent") {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        switch (sortKey) {
          case "name":
            return a.name.localeCompare(b.name) * dir;
          case "progress":
            return (a.progress - b.progress) * dir;
          case "onboarding":
            return (a.onboardingDone - b.onboardingDone) * dir;
          case "lastUpdate": {
            const av = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
            const bv = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
            return (av - bv) * dir;
          }
          default:
            return 0;
        }
      });
    }
    return out;
  }, [rows, query, status, onb, sortKey, sortDir]);

  function toggleSort(key: Exclude<SortKey, "recent">) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  }

  const hasFilters = query.trim() !== "" || status !== "all" || onb !== "all";
  function clearFilters() {
    setQuery("");
    setStatus("all");
    setOnb("all");
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
            aria-label="Search clients"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as "all" | ClientStatus)}
          className="lg:w-48"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          value={onb}
          onChange={(e) => setOnb(e.target.value as OnbFilter)}
          className="lg:w-56"
          aria-label="Filter by onboarding"
        >
          {ONB_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-ink-500">
        <span>
          Showing <span className="font-semibold text-ink-800">{filtered.length}</span>{" "}
          of {rows.length} client{rows.length === 1 ? "" : "s"}
        </span>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm font-medium text-ink-700">No clients match your filters</p>
          <p className="mt-1 text-sm text-ink-400">
            Try a different search, or clear the filters to see everyone.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
            Clear filters
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <SortableTH label="Client" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} />
                <TH>Services</TH>
                <TH>Status</TH>
                <SortableTH label="Onboarding" active={sortKey === "onboarding"} dir={sortDir} onClick={() => toggleSort("onboarding")} />
                <SortableTH label="Progress" active={sortKey === "progress"} dir={sortDir} onClick={() => toggleSort("progress")} />
                <SortableTH label="Last Update" active={sortKey === "lastUpdate"} dir={sortDir} onClick={() => toggleSort("lastUpdate")} />
                <TH>Last Report</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/admin/clients/${c.id}`} className="flex items-center gap-3">
                      <Avatar name={c.name} size="sm" />
                      <div>
                        <p className="font-semibold text-ink-900">{c.name}</p>
                        <p className="text-xs text-ink-400">{c.contactEmail ?? "—"}</p>
                      </div>
                    </Link>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {c.serviceNames.length > 0 ? (
                        c.serviceNames.map((s) => (
                          <span
                            key={s}
                            className="rounded-md bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600"
                          >
                            {s}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </div>
                  </TD>
                  <TD>
                    <ClientStatusBadge status={c.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {c.onboardingDone}/{c.onboardingTotal || 0}
                  </TD>
                  <TD>
                    <div className="flex w-28 items-center gap-2">
                      <ProgressBar value={c.progress} />
                      <span className="text-xs font-medium text-ink-500">{c.progress}%</span>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-ink-500">
                    {c.lastUpdate ? format(new Date(c.lastUpdate), "d MMM yyyy") : "—"}
                  </TD>
                  <TD className="whitespace-nowrap text-xs text-ink-500">
                    {c.lastReport ? format(new Date(c.lastReport), "MMM yyyy") : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function SortableTH({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <TH>
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-ink-900",
          active ? "text-ink-900" : "text-ink-500"
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </button>
    </TH>
  );
}
