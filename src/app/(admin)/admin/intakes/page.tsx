import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { Inbox, Archive } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listProspectIntakes, type AdminIntakeStatus } from "@/lib/prospect/intake-admin";
import { serviceLabelsFor } from "@/lib/prospect/intake-present";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { IntakeStatusBadge } from "@/components/admin/intake-status-badge";

export const metadata: Metadata = { title: "Intakes" };
export const dynamic = "force-dynamic";

function tabFrom(view: string | undefined): AdminIntakeStatus {
  return view === "dismissed" ? "dismissed" : "submitted";
}

export default async function IntakesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdmin();
  const { view } = await searchParams;
  const tab = tabFrom(view);
  const intakes = await listProspectIntakes(tab);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Intakes"
        description="Prospects who completed the public intake at /start."
      />

      {/* Submitted / Dismissed tabs — Submitted (actionable) is the default. */}
      <div className="flex gap-1 border-b border-ink-100">
        <TabLink href="/admin/intakes" active={tab === "submitted"} icon={Inbox} label="Submitted" />
        <TabLink href="/admin/intakes?view=dismissed" active={tab === "dismissed"} icon={Archive} label="Dismissed" />
      </div>

      {intakes.length === 0 ? (
        <EmptyState
          icon={tab === "submitted" ? Inbox : Archive}
          title={tab === "submitted" ? "No submitted intakes yet" : "No dismissed intakes"}
          description={
            tab === "submitted"
              ? "When a prospect completes the intake at /start, it will appear here to review and action."
              : "Intakes you dismiss will be kept here for your records."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
          <Table>
            <THead>
              <TR>
                <TH>Business</TH>
                <TH>Contact</TH>
                <TH>Services</TH>
                <TH>{tab === "submitted" ? "Submitted" : "Dismissed"}</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {intakes.map((it) => {
                const services = serviceLabelsFor(it.selected_services);
                const when = tab === "submitted" ? it.submitted_at : it.updated_at;
                return (
                  <TR key={it.id} className="cursor-pointer hover:bg-ink-50">
                    <TD className="p-0">
                      <Link href={`/admin/intakes/${it.id}`} className="block px-4 py-3">
                        <span className="font-medium text-ink-900">{it.business_name ?? "—"}</span>
                        {it.source === "personalised" && (
                          <Badge tone="neutral" className="ml-2 px-1.5 py-0 align-middle">Invited</Badge>
                        )}
                      </Link>
                    </TD>
                    <TD className="p-0">
                      <Link href={`/admin/intakes/${it.id}`} className="block px-4 py-3">
                        <span className="block text-ink-900">{it.contact_name ?? "—"}</span>
                        <span className="block text-xs text-ink-500">{it.email ?? ""}</span>
                        {it.phone && <span className="block text-xs text-ink-400">{it.phone}</span>}
                      </Link>
                    </TD>
                    <TD className="p-0">
                      <Link href={`/admin/intakes/${it.id}`} className="block px-4 py-3 text-sm text-ink-700">
                        {services.length > 0 ? services.join(", ") : "Not sure yet"}
                      </Link>
                    </TD>
                    <TD className="p-0">
                      <Link href={`/admin/intakes/${it.id}`} className="block px-4 py-3 text-sm text-ink-600">
                        {when ? format(new Date(when), "d MMM yyyy, HH:mm") : "—"}
                      </Link>
                    </TD>
                    <TD className="p-0">
                      <Link href={`/admin/intakes/${it.id}`} className="block px-4 py-3">
                        <IntakeStatusBadge status={it.status} />
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: typeof Inbox;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px",
        active
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-ink-500 hover:text-ink-800"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
