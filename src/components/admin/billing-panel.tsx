"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Plus,
  Trash2,
  Send,
  Ban,
  CreditCard,
  Pencil,
  AlertCircle,
  Wallet,
  Clock,
  Banknote,
  Repeat,
  Download,
  Mail,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { getSignedUrl } from "@/lib/upload";
import { formatCurrency } from "@/lib/utils";
import type {
  ClientBilling,
  BillingInvoice,
  BillingRetainer,
} from "@/lib/admin-queries";
import type { InvoiceKind, PaymentMethod } from "@/lib/database.types";
import {
  createClientInvoiceAction,
  updateClientInvoiceAction,
  setInvoiceStatusAction,
  markInvoicePaidAction,
  sendInvoiceReminderAction,
  deleteClientInvoiceAction,
  recordPaymentAction,
  deleteClientPaymentAction,
  addRetainerAction,
  updateRetainerAction,
  setRetainerActiveAction,
  deleteRetainerAction,
} from "@/app/(admin)/admin/actions";

type Segment = "all" | "outstanding" | "paid";

const PAYMENT_METHODS: PaymentMethod[] = [
  "eft",
  "payfast",
  "quickbooks",
  "cash",
  "manual",
];
const INVOICE_KINDS: InvoiceKind[] = ["one_off", "retainer", "custom"];

/** YYYY-MM-DD for <input type="date"> from an ISO timestamp. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}
/** A date input value back to an ISO timestamp (or null). */
function fromDateInput(v: string): string | null {
  return v ? new Date(v + "T00:00:00").toISOString() : null;
}

/**
 * One formatted line per currency (ZAR first), e.g. ["R 12 000", "$500"].
 * An empty record renders as a single zero in ZAR.
 */
function currencyLines(byCurrency: Record<string, number>): string[] {
  const entries = Object.entries(byCurrency).sort(([a], [b]) =>
    a === "ZAR" ? -1 : b === "ZAR" ? 1 : a.localeCompare(b)
  );
  if (entries.length === 0) return [formatCurrency(0)];
  return entries.map(([currency, amount]) => formatCurrency(amount, currency));
}

export function BillingPanel({
  clientId,
  billing,
}: {
  clientId: string;
  billing: ClientBilling;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>("all");

  // Modals
  const [invoiceModal, setInvoiceModal] = useState<BillingInvoice | "new" | null>(
    null
  );
  const [paymentFor, setPaymentFor] = useState<BillingInvoice | "adhoc" | null>(
    null
  );
  const [retainerModal, setRetainerModal] = useState<
    BillingRetainer | "new" | null
  >(null);

  const { invoices, payments, retainers, kpis } = billing;

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  async function openPath(path: string) {
    try {
      const url = await getSignedUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the file.");
    }
  }

  const visibleInvoices = invoices.filter((i) => {
    if (segment === "outstanding") return i.status === "sent";
    if (segment === "paid") return i.status === "paid";
    return true;
  });

  return (
    <div className="space-y-6">
      {error && (
        <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {/* KPI cards — money totals are shown per currency, never mixed. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Wallet}
          label="Outstanding"
          value={currencyLines(kpis.outstandingByCurrency)}
          tone="amber"
        />
        <Kpi
          icon={Banknote}
          label="Paid (lifetime)"
          value={currencyLines(kpis.paidByCurrency)}
          tone="emerald"
        />
        <Kpi
          icon={Clock}
          label="Overdue"
          value={String(kpis.overdueCount)}
          tone={kpis.overdueCount > 0 ? "red" : "ink"}
        />
        <Kpi
          icon={Repeat}
          label="Active retainers"
          value={String(kpis.activeRetainers)}
          tone="ink"
        />
      </div>

      {/* Invoices */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900">Invoices</h3>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-ink-200 p-0.5">
              {(["all", "outstanding", "paid"] as Segment[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSegment(s)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                    segment === s
                      ? "bg-ink-900 text-white"
                      : "text-ink-500 hover:text-ink-800"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setInvoiceModal("new")}>
              <Plus className="h-4 w-4" /> New invoice
            </Button>
          </div>
        </div>

        {visibleInvoices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
            No invoices to show.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleInvoices.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ink-100 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-400">
                      {inv.invoice_number}
                    </span>
                    <InvoiceStatusBadge status={inv.derivedStatus} />
                  </div>
                  <p className="truncate text-sm font-medium text-ink-900">
                    {inv.title}
                  </p>
                  <p className="text-xs text-ink-400">
                    {inv.due_at ? `Due ${format(new Date(inv.due_at), "d MMM yyyy")}` : "No due date"}
                    {inv.balance > 0 && inv.amountPaid > 0
                      ? ` · ${formatCurrency(inv.balance)} outstanding`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-ink-900">
                    {formatCurrency(inv.amount, inv.currency)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {inv.pdf && (
                    <IconBtn
                      title="Download PDF"
                      onClick={() => openPath(inv.pdf!.path)}
                      disabled={pending}
                    >
                      <Download className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status === "draft" && (
                    <IconBtn
                      title="Mark sent"
                      onClick={() => run(() => setInvoiceStatusAction(inv.id, "sent"))}
                      disabled={pending}
                    >
                      <Send className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status === "sent" && (
                    <IconBtn
                      title="Send reminder"
                      onClick={() => run(() => sendInvoiceReminderAction(inv.id))}
                      disabled={pending}
                    >
                      <Mail className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status === "sent" && (
                    <IconBtn
                      title="Mark paid"
                      onClick={() => run(() => markInvoicePaidAction(inv.id))}
                      disabled={pending}
                    >
                      <CheckCheck className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {(inv.status === "sent" || inv.status === "paid") && (
                    <IconBtn
                      title="Record payment"
                      onClick={() => setPaymentFor(inv)}
                      disabled={pending}
                    >
                      <CreditCard className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status !== "paid" && inv.status !== "void" && (
                    <IconBtn
                      title="Edit"
                      onClick={() => setInvoiceModal(inv)}
                      disabled={pending}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status !== "void" && inv.status !== "paid" && (
                    <IconBtn
                      title="Void"
                      onClick={() => run(() => setInvoiceStatusAction(inv.id, "void"))}
                      disabled={pending}
                    >
                      <Ban className="h-4 w-4" />
                    </IconBtn>
                  )}
                  {inv.status === "draft" && (
                    <IconBtn
                      title="Delete"
                      onClick={() => run(() => deleteClientInvoiceAction(inv.id))}
                      disabled={pending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconBtn>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Payment history */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">Payment history</h3>
          <Button size="sm" variant="outline" onClick={() => setPaymentFor("adhoc")}>
            <Plus className="h-4 w-4" /> Record payment
          </Button>
        </div>
        {payments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
            No payments recorded.
          </p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-ink-100 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-900">
                    {formatCurrency(p.amount, p.invoiceCurrency ?? "ZAR")}{" "}
                    <span className="font-normal capitalize text-ink-400">
                      · {p.method}
                    </span>
                  </p>
                  <p className="text-xs text-ink-400">
                    {format(new Date(p.received_at), "d MMM yyyy")}
                    {p.invoiceNumber ? ` · ${p.invoiceNumber}` : " · unlinked"}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </p>
                </div>
                <IconBtn
                  title="Delete payment"
                  onClick={() => run(() => deleteClientPaymentAction(p.id))}
                  disabled={pending}
                >
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Retainers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-900">Monthly retainers</h3>
          <Button size="sm" variant="outline" onClick={() => setRetainerModal("new")}>
            <Plus className="h-4 w-4" /> Add retainer
          </Button>
        </div>
        {retainers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
            No retainers tracked.
          </p>
        ) : (
          <div className="space-y-2">
            {retainers.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-ink-100 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{r.name}</span>
                    <Badge tone={r.active ? "success" : "neutral"}>
                      {r.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-xs text-ink-400">
                    {formatCurrency(r.amount)} / month
                    {r.started_at ? ` · since ${format(new Date(r.started_at), "MMM yyyy")}` : ""}
                  </p>
                </div>
                <IconBtn
                  title={r.active ? "Deactivate" : "Activate"}
                  onClick={() => run(() => setRetainerActiveAction(r.id, !r.active))}
                  disabled={pending}
                >
                  <Repeat className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Edit" onClick={() => setRetainerModal(r)} disabled={pending}>
                  <Pencil className="h-4 w-4" />
                </IconBtn>
                <IconBtn
                  title="Delete"
                  onClick={() => run(() => deleteRetainerAction(r.id))}
                  disabled={pending}
                >
                  <Trash2 className="h-4 w-4" />
                </IconBtn>
              </div>
            ))}
          </div>
        )}
      </section>

      {invoiceModal && (
        <InvoiceModal
          clientId={clientId}
          invoice={invoiceModal === "new" ? null : invoiceModal}
          pending={pending}
          onClose={() => setInvoiceModal(null)}
          onSubmit={(action, after) => run(action, after)}
        />
      )}
      {paymentFor && (
        <PaymentModal
          clientId={clientId}
          invoice={paymentFor === "adhoc" ? null : paymentFor}
          pending={pending}
          onClose={() => setPaymentFor(null)}
          onSubmit={(action, after) => run(action, after)}
        />
      )}
      {retainerModal && (
        <RetainerModal
          clientId={clientId}
          retainer={retainerModal === "new" ? null : retainerModal}
          pending={pending}
          onClose={() => setRetainerModal(null)}
          onSubmit={(action, after) => run(action, after)}
        />
      )}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  /** A single value, or one line per currency (first line rendered largest). */
  value: string | string[];
  tone: "amber" | "emerald" | "red" | "ink";
}) {
  const toneClass = {
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    red: "text-red-600",
    ink: "text-ink-500",
  }[tone];
  const [first, ...rest] = Array.isArray(value) ? value : [value];
  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className={`flex items-center gap-1.5 ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-ink-900">{first}</p>
      {rest.map((line) => (
        <p key={line} className="text-sm font-semibold text-ink-700">
          {line}
        </p>
      ))}
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      {children}
    </label>
  );
}

const selectClass =
  "flex h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 shadow-sm focus-visible:outline-none focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-100";

// ── Modals ──────────────────────────────────────────────────────────────────

type RunSubmit = (
  action: () => Promise<{ ok?: boolean; error?: string }>,
  after?: () => void
) => void;

function InvoiceModal({
  clientId,
  invoice,
  pending,
  onClose,
  onSubmit,
}: {
  clientId: string;
  invoice: BillingInvoice | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: RunSubmit;
}) {
  const editing = invoice != null;
  const [title, setTitle] = useState(invoice?.title ?? "");
  const [description, setDescription] = useState(invoice?.description ?? "");
  const [amount, setAmount] = useState(invoice ? String(invoice.amount) : "");
  const [currency, setCurrency] = useState<string>(invoice?.currency ?? "ZAR");
  const [kind, setKind] = useState<InvoiceKind>(invoice?.kind ?? "one_off");
  const [issuedAt, setIssuedAt] = useState(toDateInput(invoice?.issued_at ?? null));
  const [dueAt, setDueAt] = useState(toDateInput(invoice?.due_at ?? null));
  const [fileId, setFileId] = useState<string | null>(invoice?.file_id ?? null);
  const [fileName, setFileName] = useState<string | null>(invoice?.pdf?.name ?? null);
  const [send, setSend] = useState(false);

  function submit() {
    const fields = {
      title,
      description,
      amount: Number(amount),
      currency,
      kind,
      issuedAt: fromDateInput(issuedAt),
      dueAt: fromDateInput(dueAt),
      fileId,
    };
    if (editing) {
      onSubmit(() => updateClientInvoiceAction(invoice!.id, fields), onClose);
    } else {
      onSubmit(
        () => createClientInvoiceAction(clientId, { ...fields, send }),
        onClose
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit invoice" : "New invoice"}
    >
      <div className="space-y-4 p-6">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Website Package" />
        </Field>
        <Field label="Description (optional)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <select
              className={selectClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="ZAR">ZAR</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as InvoiceKind)}>
              {INVOICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "one_off" ? "One-off" : k === "retainer" ? "Retainer" : "Custom"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invoice date (optional)">
            <Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Due date (optional)">
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field label="Invoice PDF (optional)">
          {fileName ? (
            <div className="flex items-center justify-between rounded-xl border border-ink-200 px-3 py-2 text-sm">
              <span className="truncate text-ink-700">{fileName}</span>
              <button
                type="button"
                onClick={() => {
                  setFileId(null);
                  setFileName(null);
                }}
                className="ml-2 shrink-0 text-xs font-medium text-ink-400 hover:text-rose-500"
              >
                Remove
              </button>
            </div>
          ) : (
            <FileDropzone
              clientId={clientId}
              assetCategory="invoices"
              subcategory="invoice"
              clientVisible
              multiple={false}
              onUploaded={(rec) => {
                setFileId(rec.id);
                setFileName(rec.name);
              }}
            />
          )}
        </Field>
        {!editing && (
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
            Mark as sent immediately
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={pending}>
            {editing ? "Save changes" : "Create invoice"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentModal({
  clientId,
  invoice,
  pending,
  onClose,
  onSubmit,
}: {
  clientId: string;
  invoice: BillingInvoice | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: RunSubmit;
}) {
  const [amount, setAmount] = useState(
    invoice ? String(invoice.balance > 0 ? invoice.balance : invoice.amount) : ""
  );
  const [method, setMethod] = useState<PaymentMethod>("eft");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState(toDateInput(new Date().toISOString()));
  const [notes, setNotes] = useState("");

  function submit() {
    onSubmit(
      () =>
        recordPaymentAction(clientId, {
          invoiceId: invoice?.id ?? null,
          amount: Number(amount),
          method,
          reference,
          receivedAt: fromDateInput(receivedAt),
          notes,
        }),
      onClose
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment"
      description={invoice ? `For ${invoice.invoice_number} — ${invoice.title}` : "Unlinked payment"}
    >
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount (${invoice?.currency ?? "ZAR"})`}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Method">
            <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m} className="capitalize">
                  {m}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Date received">
          <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </Field>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="EFT ref / transaction id" />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={pending}>
            Record payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RetainerModal({
  clientId,
  retainer,
  pending,
  onClose,
  onSubmit,
}: {
  clientId: string;
  retainer: BillingRetainer | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: RunSubmit;
}) {
  const editing = retainer != null;
  const [name, setName] = useState(retainer?.name ?? "");
  const [amount, setAmount] = useState(retainer ? String(retainer.amount) : "");
  const [startedAt, setStartedAt] = useState(retainer?.started_at ?? "");
  const [notes, setNotes] = useState(retainer?.notes ?? "");

  function submit() {
    const fields = {
      name,
      amount: Number(amount),
      startedAt: startedAt || null,
      notes,
    };
    if (editing) {
      onSubmit(() => updateRetainerAction(retainer!.id, fields), onClose);
    } else {
      onSubmit(() => addRetainerAction(clientId, fields), onClose);
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? "Edit retainer" : "Add retainer"}>
      <div className="space-y-4 p-6">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SEO Retainer" />
        </Field>
        <Field label="Amount (ZAR / month)">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Started (optional)">
          <Input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={pending}>
            {editing ? "Save changes" : "Add retainer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
