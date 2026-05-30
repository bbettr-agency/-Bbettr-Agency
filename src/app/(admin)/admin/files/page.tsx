import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { FolderOpen, FileText } from "lucide-react";
import { getAllFilesGlobal } from "@/lib/admin-queries";
import { formatBytes } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata: Metadata = { title: "All Files" };

export default async function AdminFilesPage() {
  const files = await getAllFilesGlobal();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Files"
        description="All files uploaded across every client. Manage files within each client's portal."
      />

      {files.length > 0 ? (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>File</TH>
                <TH>Client</TH>
                <TH>Category</TH>
                <TH>Size</TH>
                <TH>Uploaded</TH>
              </TR>
            </THead>
            <TBody>
              {files.map((f) => {
                const clientName =
                  (f.clients as { name: string } | null)?.name ?? "Client";
                return (
                  <TR key={f.id}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-ink-400" />
                        <span className="font-medium text-ink-900">{f.name}</span>
                      </div>
                    </TD>
                    <TD>
                      <Link
                        href={`/admin/clients/${f.client_id}`}
                        className="hover:text-brand-600"
                      >
                        {clientName}
                      </Link>
                    </TD>
                    <TD className="capitalize">{f.category.replace("_", " ")}</TD>
                    <TD>{f.size_bytes ? formatBytes(f.size_bytes) : "—"}</TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {format(new Date(f.created_at), "d MMM yyyy")}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="No files yet"
          description="Files uploaded by clients will appear here."
        />
      )}
    </div>
  );
}
