import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getClientContracts } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContractList } from "@/components/client/contract-list";

export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const profile = await requireClient();
  const contracts = await getClientContracts(profile.client_id);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Contracts"
        description="Your agreements with Bbettr Agency. Download your signed copies any time."
      />

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No contracts yet"
          description="Your agreement is being prepared. We’ll let you know when it’s ready."
        />
      ) : (
        <ContractList contracts={contracts} />
      )}
    </div>
  );
}
