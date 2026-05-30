"use client";

import { useState } from "react";
import { UploadCloud, Loader2, CheckCircle2 } from "lucide-react";
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

export function FileDropzone({
  clientId,
  category,
  accept,
  multiple = true,
  onUploaded,
  className,
}: FileDropzoneProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const record = await uploadClientFile(clientId, file, category);
        setDone((d) => [...d, file.name]);
        onUploaded?.(record);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

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

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {done.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {done.map((name, i) => (
            <li
              key={`${name}-${i}`}
              className="flex items-center gap-2 text-sm text-ink-600"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="truncate">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
