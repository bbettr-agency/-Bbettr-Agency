import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { CreateRepForm } from "@/components/admin/create-rep-form";

export const metadata: Metadata = { title: "New Rep" };

export default async function NewRepPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <Link
        href="/admin/reps"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to reps
      </Link>
      <PageHeader
        title="Add a sales rep"
        description="Create the rep's login and commission rate. They'll sign in at the portal and land on their own deals dashboard."
      />
      <CreateRepForm />
    </div>
  );
}
