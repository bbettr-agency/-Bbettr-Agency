"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Copy, ArrowRight, Loader2, Link2, Unlink } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  setIntakeStatusAction,
  provisionPortalAccessAction,
  linkDealToClientAction,
  unlinkDealAction,
} from "@/app/(admin)/admin/actions";
import { INTAKE_STEPS, intakeIndex } from "@/lib/intake";
import { Button } from "@/components/ui/button";
import type { IntakeStatus } from "@/lib/database.types";
import type { DealLink, LinkableDeal } from "@/lib/admin-queries";

interface IntakePanelProps {
  clientId: string;
  onboardingType: string;
  intakeStatus: string;
  contractStatus: "none" | "not_sent" | "sent" | "signed";
  hasPortalAccess: boolean;
  welcomeEmailSent: boolean;
  dealLink: DealLink | null;
  linkableDeals: LinkableDeal[];
}

const CONTRACT_LABEL: Record<string, string> = {
  none: "No contract",
  not_sent: "Not sent",
  sent: "Sent",
  signed: "Signed",
};

export function IntakePanel({
  clientId,
  onboardingType,
  intakeStatus,
  contractStatus,
  hasPortalAccess,
  welcomeEmailSent,
  dealLink,
  linkableDeals,
}: IntakePanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState("");

  function linkDeal() {
    if (!selectedDeal) return;
    setError(null);
    startTransition(async () => {
      const res = await linkDealToClientAction(clientId, selectedDeal);
      if (res.error) setError(res.error);
      else {
        setSelectedDeal("");
        router.refresh();
      }
    });
  }

  function unlinkDeal() {
    setError(null);
    startTransition(async () => {
      const res = await unlinkDealAction(clientId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const currentIdx = intakeIndex(intakeStatus);
  const nextStep = INTAKE_STEPS[currentIdx + 1];

  function advanceTo(status: IntakeStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setIntakeStatusAction(clientId, status);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function grantAccess() {
    setError(null);
    setTempPassword(null);
    startTransition(async () => {
      const res = await provisionPortalAccessAction(clientId);
      if (res.password) setTempPassword(res.password);
      if (res.error) setError(res.error);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
          {error}
        </p>
      )}

      {/* Status chips */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatusChip label="Onboarding Type" value={onboardingType === "new" ? "New Client" : "Legacy Client"} />
        <StatusChip label="Intake Status" value={INTAKE_STEPS[currentIdx]?.label ?? intakeStatus} />
        <StatusChip label="Contract" value={CONTRACT_LABEL[contractStatus] ?? contractStatus} />
        <StatusChip label="Portal Access" value={hasPortalAccess ? "Active" : "Not provisioned"} tone={hasPortalAccess ? "good" : "muted"} />
        <StatusChip label="Welcome Email" value={welcomeEmailSent ? "Sent" : "Not sent"} tone={welcomeEmailSent ? "good" : "muted"} />
      </div>

      {/* Temp password (after granting access) */}
      {tempPassword && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700">
            Portal access granted. Temporary password (shown once):
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-sm text-ink-900">
              {tempPassword}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(tempPassword).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Linked deal (Phase D2) */}
      <div className="rounded-xl border border-ink-100 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-ink-500">
          <Link2 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium uppercase tracking-wide">
            Linked Deal
          </span>
        </div>

        {dealLink ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-ink-900">
                {dealLink.deal.business_name}
              </span>
              {dealLink.deal.package && (
                <span className="text-sm text-ink-500">{dealLink.deal.package}</span>
              )}
              {dealLink.deal.price != null && (
                <span className="text-sm text-ink-500">
                  {formatCurrency(dealLink.deal.price)}
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <StatusChip label="Deal" value={dealLink.deal.status} />
              <StatusChip
                label="Invoice"
                value={dealLink.invoiceStatus ?? "—"}
                tone={dealLink.invoiceStatus === "invoiced" ? "good" : "muted"}
              />
              <StatusChip
                label="Payment"
                value={dealLink.paymentStatus ?? "—"}
                tone={dealLink.paymentStatus === "paid" ? "good" : "muted"}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              loading={pending}
              onClick={unlinkDeal}
            >
              <Unlink className="h-4 w-4" /> Unlink deal
            </Button>
          </div>
        ) : linkableDeals.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDeal}
              onChange={(e) => setSelectedDeal(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-900"
            >
              <option value="">Select a deal to link…</option>
              {linkableDeals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.business_name}
                  {d.repName ? ` · ${d.repName}` : ""}
                  {d.price != null ? ` · ${formatCurrency(d.price)}` : ""}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              loading={pending}
              disabled={!selectedDeal}
              onClick={linkDeal}
            >
              <Link2 className="h-4 w-4" /> Link
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-400">
            No deal linked. No unlinked deals are available to attach.
          </p>
        )}
      </div>

      {/* Pipeline progression */}
      <ol className="relative space-y-1">
        {INTAKE_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          const isNext = nextStep && step.key === nextStep.key;
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2",
                current && "bg-brand-50/60"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
                  done
                    ? "bg-brand-500 text-white"
                    : current
                      ? "bg-amber-100 text-amber-600 ring-2 ring-amber-200"
                      : "border-2 border-ink-200 text-ink-300"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "flex-1 text-sm",
                  current ? "font-semibold text-ink-900" : done ? "text-ink-600" : "text-ink-400"
                )}
              >
                {step.label}
              </span>
              {isNext && <NextAction />}
            </li>
          );
        })}
      </ol>
    </div>
  );

  function NextAction() {
    if (!nextStep) return null;
    // The Portal Access step provisions the login + welcome email.
    if (nextStep.key === "portal_access_sent" && !hasPortalAccess) {
      return (
        <Button size="sm" loading={pending} onClick={grantAccess}>
          <KeyRound className="h-4 w-4" /> Grant Portal Access
        </Button>
      );
    }
    const label =
      nextStep.key === "invoice_sent"
        ? "Mark Invoice Sent"
        : nextStep.key === "paid"
          ? "Mark Invoice Paid"
          : `Mark ${nextStep.label}`;
    return (
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        onClick={() => advanceTo(nextStep.key)}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {label}
      </Button>
    );
  }
}

function StatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "muted";
}) {
  return (
    <div className="rounded-xl border border-ink-100 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold",
          tone === "good" ? "text-emerald-700" : tone === "muted" ? "text-ink-400" : "text-ink-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}
