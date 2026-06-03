"use client";

import { useState } from "react";
import { UploadCloud, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadClientFile } from "@/lib/upload";
import type { FileCategory, FileRecord } from "@/lib/database.types";

interface FileDropzoneProps {
  clientId: string;
  category?: FileCategory;
  accept?: string;
  multiple?: boolean;
  onUploaded?: (file: FileRecord) => void;
  className?: string;
}

/** Per-file upload outcome shown in the results list. */
interface UploadResult {
  id: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

export function FileDropzone({
  clientId,
  category,
  accept,
  multiple = true,
  onUploaded,
  className,
}: FileDropzoneProps) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    // Each file is uploaded independently: one failure never stops the rest,
    // and every file reports its own success/failure to the user.
    let id = results.length;
    for (const file of Array.from(files)) {
      const entryId = id++;
      try {
        const record = await uploadClientFile(clientId, file, category);
        setResults((r) => [
          ...r,
          { id: entryId, name: file.name, status: "success" },
        ]);
        onUploaded?.(record);
      } catch (e) {
        setResults((r) => [
          ...r,
          {
            id: entryId,
            name: file.name,
            status: "error",
            message: e instanceof Error ? e.message : "Upload failed.",
          },
        ]);
      }
    }
    setBusy(false);
  }

  const failed = results.filter((r) => r.status === "error").length;

  return (
    <div className={className}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver
            ? "border-brand-400 bg-brand-50"
            : "border-ink-200 bg-ink-50/50 hover:border-brand-300 hover:bg-brand-50/40"
        )}
      >
        <input
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={busy}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <UploadCloud className="h-5 w-5" />
          )}
        </span>
        <span className="mt-3 text-sm font-semibold text-ink-800">
          {busy ? "Uploading…" : "Click to upload or drag & drop"}
        </span>
        <span className="mt-1 text-xs text-ink-400">
          {accept ? accept.replaceAll(",", ", ") : "Any file type"}
        </span>
      </label>

      {failed > 0 && (
        <p className="mt-2 text-sm font-medium text-red-600">
          {failed} of {results.length} file{results.length === 1 ? "" : "s"}{" "}
          failed to upload. See details below.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {results.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex items-start gap-2 text-sm",
                r.status === "success" ? "text-ink-600" : "text-red-600"
              )}
            >
              {r.status === "success" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              )}
              <span className="min-w-0">
                <span className="truncate">{r.name}</span>
                {r.message && (
                  <span className="text-xs text-red-500"> — {r.message}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
