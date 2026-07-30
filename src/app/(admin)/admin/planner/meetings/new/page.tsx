import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePlannerAccess } from "@/lib/planner/guard";
import { PageHeader } from "@/components/ui/page-header";
import { MeetingForm } from "@/components/planner/meeting-form";

export const metadata: Metadata = { title: "New meeting" };

export default async function NewMeetingPage() {
  await requirePlannerAccess();

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <Link
        href="/admin/planner/meetings"
        className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"
      >
        <ChevronLeft className="h-4 w-4" /> Meetings
      </Link>
      <PageHeader title="New meeting" />
      <MeetingForm />
    </div>
  );
}
