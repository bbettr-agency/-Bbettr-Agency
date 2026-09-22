import type { Metadata } from "next";
import { SeenMarker } from "@/components/shared/seen-marker";
import { requireClientWorkspace } from "@/lib/auth";
import { getFiles } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { FileManager } from "@/components/files/file-manager";

export const metadata: Metadata = { title: "Files" };

export default async function FilesPage() {
  const { clientId } = await requireClientWorkspace();
  const files = await getFiles(clientId);

  return (
    <div className="space-y-6 animate-fade-in">
      <SeenMarker section="files" />
      <PageHeader
        title="Files"
        description="Securely upload and manage your logos, brand guides, images, videos and documents."
      />
      <FileManager clientId={clientId} initialFiles={files} />
    </div>
  );
}
