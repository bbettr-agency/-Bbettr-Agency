"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  FileText,
  ImageIcon,
  Film,
  File as FileIcon,
  Download,
  Trash2,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getSignedUrl, STORAGE_BUCKET } from "@/lib/upload";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderOpen } from "lucide-react";
import type { FileRecord } from "@/lib/database.types";

function iconFor(mime: string | null) {
  if (!mime) return FileIcon;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Film;
  if (mime === "application/pdf") return FileText;
  return FileIcon;
}

interface FileManagerProps {
  clientId: string;
  initialFiles: FileRecord[];
  /** When true (admin), hide upload + delete controls. */
  readOnly?: boolean;
}

export function FileManager({
  clientId,
  initialFiles,
  readOnly = false,
}: FileManagerProps) {
  const [files, setFiles] = useState<FileRecord[]>(initialFiles);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function open(file: FileRecord) {
    const url = await getSignedUrl(file.path);
    window.open(url, "_blank");
  }

  async function remove(file: FileRecord) {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    setBusyId(file.id);
    const supabase = createClient();
    await supabase.storage.from(STORAGE_BUCKET).remove([file.path]);
    await supabase.from("files").delete().eq("id", file.id);
    setFiles((f) => f.filter((x) => x.id !== file.id));
    setBusyId(null);
  }

  return (
    <div className="space-y-6">
      {!readOnly && (
        <FileDropzone
          clientId={clientId}
          onUploaded={(rec) => setFiles((f) => [rec, ...f])}
        />
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No files yet"
          description={
            readOnly
              ? "This client hasn't uploaded any files."
              : "Upload logos, brand guides, images, videos and documents above."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => {
            const Icon = iconFor(file.mime_type);
            return (
              <Card
                key={file.id}
                className="group flex items-center gap-3 p-3.5 transition-shadow hover:shadow-card-hover"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => open(file)}
                    className="block truncate text-left text-sm font-medium text-ink-900 hover:text-brand-600"
                  >
                    {file.name}
                  </button>
                  <p className="text-xs text-ink-400">
                    {file.size_bytes ? formatBytes(file.size_bytes) : "—"} ·{" "}
                    {format(new Date(file.created_at), "d MMM yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => open(file)}
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                    aria-label="Download"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {!readOnly && (
                    <button
                      onClick={() => remove(file)}
                      disabled={busyId === file.id}
                      className={cn(
                        "rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-500",
                        busyId === file.id && "opacity-50"
                      )}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
