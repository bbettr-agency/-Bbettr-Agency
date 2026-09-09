import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Mail, Phone, MapPin, Globe, Clock, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getProspectIntake } from "@/lib/prospect/intake-admin";
import { presentIntake } from "@/lib/prospect/intake-present";
import { canDismiss } from "@/lib/prospect/intake-lifecycle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntakeStatusBadge } from "@/components/admin/intake-status-badge";
import { ProspectIntakeDismiss } from "@/components/admin/prospect-intake-dismiss";

export const metadata: Metadata = { title: "Intake" };
export const dynamic = "force-dynamic";

export default async function IntakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const row = await getProspectIntake(id);
  if (!row) notFound();

  const { header, sections } = presentIntake(row);
  const submittedLabel = header.submittedAt
    ? format(new Date(header.submittedAt), "d MMM yyyy 'at' HH:mm")
    : "—";

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href={header.status === "dismissed" ? "/admin/intakes?view=dismissed" : "/admin/intakes"}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-colors hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to intakes
      </Link>

      <PageHeader
        title={header.business ?? header.contact ?? "Prospect intake"}
        description={header.contact && header.business ? header.contact : undefined}
        actions={
          <div className="flex items-center gap-3">
            <IntakeStatusBadge status={header.status} />
            {canDismiss(header.status) && (
              <ProspectIntakeDismiss intakeId={row.id} business={header.business} contact={header.contact} />
            )}
          </div>
        }
      />

      {/* Prominent contact/business facts — the things we act on first. */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-4 py-5 sm:grid-cols-2">
          <Fact icon={Building2} label="Business" value={header.business} />
          <Fact icon={Clock} label="Submitted" value={submittedLabel} />
          <Fact
            icon={Mail}
            label="Email"
            value={header.email}
            href={header.email ? `mailto:${header.email}` : undefined}
          />
          <Fact
            icon={Phone}
            label="Phone"
            value={header.phone}
            href={header.phone ? `tel:${header.phone.replace(/\s+/g, "")}` : undefined}
          />
          <Fact icon={MapPin} label="Location" value={header.location} />
          <Fact
            icon={Globe}
            label="Website"
            value={header.website}
            href={header.website ?? undefined}
            external
          />
        </CardContent>
      </Card>

      {/* The actual answers, grouped and labelled (no raw JSON). */}
      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            <dl className="grid gap-3">
              {section.rows.map((r) => (
                <div key={r.label} className="grid grid-cols-1 gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <dt className="text-sm text-ink-500">{r.label}</dt>
                  <dd className="text-sm text-ink-900">{r.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}

      <p className="px-1 text-xs text-ink-400">
        Source: {header.source === "personalised" ? "personalised link" : "public link"} · This is a
        prospect enquiry — no client account is created until you explicitly convert it later.
      </p>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  href,
  external,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null;
  href?: string;
  external?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
        {value ? (
          href ? (
            <a
              href={href}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener noreferrer" : undefined}
              className="break-words text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              {value}
            </a>
          ) : (
            <p className="break-words text-sm font-medium text-ink-900">{value}</p>
          )
        ) : (
          <p className="text-sm text-ink-400">—</p>
        )}
      </div>
    </div>
  );
}
