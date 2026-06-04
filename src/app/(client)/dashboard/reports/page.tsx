import type { Metadata } from "next";
import { SeenMarker } from "@/components/shared/seen-marker";
import { BarChart3 } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getReports } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReportCard } from "@/components/reports/report-card";
import { STORAGE_BUCKET } from "@/lib/upload";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const profile = await requireClient();
  const reports = await getReports(profile.client_id);

  // Pre-sign any attached PDFs server-side.
  const supabase = await createClient();
  const withUrls = await Promise.all(
    reports.map(async (r) => {
      let pdfUrl: string | null = null;
      if (r.pdf_path) {
        const { data } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(r.pdf_path, 60 * 60);
        pdfUrl = data?.signedUrl ?? null;
      }
      return { report: r, pdfUrl };
    })
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <SeenMarker section="reports" />
      <PageHeader
        title="Monthly Reports"
        description="Transparent, detailed performance reporting — every month."
      />

      {withUrls.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {withUrls.map(({ report, pdfUrl }) => (
            <ReportCard key={report.id} report={report} pdfUrl={pdfUrl} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="No reports yet"
          description="Your first monthly performance report will appear here once published."
        />
      )}
    </div>
  );
}
