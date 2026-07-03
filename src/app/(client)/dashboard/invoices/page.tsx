import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { SeenMarker } from "@/components/shared/seen-marker";
import { requireClient } from "@/lib/auth";
import { getClientInvoices } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { InvoiceList } from "@/components/client/invoice-list";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const profile = await requireClient();
  const invoices = await getClientInvoices(profile.client_id);

  return (
    <div className="space-y-6 animate-fade-in">
      <SeenMarker section="invoices" />
      <PageHeader
        title="Invoices"
        description="View and download your invoices from Bbettr Agency."
      />

      {invoices.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Your invoices will appear here once they’re issued. We’ll email you when a new one is available."
        />
      ) : (
        <InvoiceList invoices={invoices} />
      )}
    </div>
  );
}
