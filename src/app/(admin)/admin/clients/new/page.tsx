import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { NewClientForm } from "./new-client-form";

export const metadata: Metadata = { title: "New Client" };

export default async function NewClientPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>
      <PageHeader
        title="Create a new client"
        description="Set up a new tenant, choose their services and provision their portal login."
      />
      <NewClientForm />
    </div>
  );
}
