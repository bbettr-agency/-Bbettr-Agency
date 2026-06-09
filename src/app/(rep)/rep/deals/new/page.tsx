import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRep } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { NewDealForm } from "@/components/rep/new-deal-form";

export const metadata: Metadata = { title: "New Deal" };

export default async function NewDealPage() {
  await requireRep();

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <Link
        href="/rep"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my deals
      </Link>
      <PageHeader
        title="Log a new deal"
        description="Capture the deal you just closed. We'll raise an invoice request for approval."
      />
      <NewDealForm />
    </div>
  );
}
