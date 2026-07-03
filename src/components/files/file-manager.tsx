"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  FileText,
  ImageIcon,
  Film,
  File as FileIcon,
  Download,
  Trash2,
  AlertCircle,
  EyeOff,
  FolderOpen,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getSignedUrl, STORAGE_BUCKET } from "@/lib/upload";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_ORDER,
  allCategories,
  clientUploadCategories,
  categoryLabel,
  subcategoryLabel,
  type AssetCategoryKey,
} from "@/lib/assets";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
  /** Admin: upload to any category + a "visible to client" toggle + see hidden files. */
  isAdmin?: boolean;
}

export function FileManager({
  clientId,
  initialFiles,
  isAdmin = false,
}: FileManagerProps) {
  const [files, setFiles] = useState<FileRecord[]>(initialFiles);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadable = isAdmin ? allCategories() : clientUploadCategories();
  const [category, setCategory] = useState<AssetCategoryKey>(
    uploadable[0]?.key ?? "documents"
  );
  const [subcategory, setSubcategory] = useState<string>(
    uploadable[0]?.subcategories[0]?.key ?? ""
  );
  const [clientVisible, setClientVisible] = useState(true);

  const subOptions = ASSET_CATEGORIES[category]?.subcategories ?? [];

  function onCategoryChange(next: AssetCategoryKey) {
    setCategory(next);
    setSubcategory(ASSET_CATEGORIES[next]?.subcategories[0]?.key ?? "");
  }

  // Group files by category for display, in catalog order.
  const grouped = useMemo(() => {
    const byCat = new Map<string, FileRecord[]>();
    for (const f of files) {
      const key = f.asset_category ?? "documents";
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(f);
    }
    return ASSET_CATEGORY_ORDER.map((key) => ({
      key,
      files: byCat.get(key) ?? [],
    })).filter((g) => g.files.length > 0);
  }, [files]);

  async function open(file: FileRecord) {
    try {
      const url = await getSignedUrl(file.path);
      window.open(url, "_blank");
    } catch (e) {
      setError(
        `Could not open "${file.name}": ${
          e instanceof Error ? e.message : "unknown error"
        }`
      );
    }
  }

  async function remove(file: FileRecord) {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    setBusyId(file.id);
    setError(null);
    const supabase = createClient();
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([file.path]);
      const { error: dbError } = await supabase
        .from("files")
        .delete()
        .eq("id", file.id);
      if (dbError) throw new Error(dbError.message);
      setFiles((f) => f.filter((x) => x.id !== file.id));
    } catch (e) {
      setError(
        `Could not delete "${file.name}": ${
          e instanceof Error ? e.message : "unknown error"
        }. The file was left in place.`
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Upload — category + subcategory picker, then drop zone */}
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-400">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value as AssetCategoryKey)}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              {uploadable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-400">
              Type
            </label>
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              {subOptions.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input
              type="checkbox"
              checked={clientVisible}
              onChange={(e) => setClientVisible(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-200"
            />
            Visible to client
          </label>
        )}

        <FileDropzone
          key={`${category}-${subcategory}-${clientVisible}`}
          clientId={clientId}
          assetCategory={category}
          subcategory={subcategory || null}
          clientVisible={isAdmin ? clientVisible : true}
          onUploaded={(rec) => setFiles((f) => [rec, ...f])}
        />
      </Card>

      {files.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No files yet"
          description="Upload contracts, branding, content, media and documents above."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => {
            const CatIcon = ASSET_CATEGORIES[group.key as AssetCategoryKey]?.icon ?? FolderOpen;
            return (
              <div key={group.key}>
                <div className="mb-2.5 flex items-center gap-2">
                  <CatIcon className="h-4 w-4 text-brand-500" />
                  <h3 className="text-sm font-semibold text-ink-900">
                    {categoryLabel(group.key)}
                  </h3>
                  <span className="text-xs text-ink-400">{group.files.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.files.map((file) => {
                    const Icon = iconFor(file.mime_type);
                    const subLabel = subcategoryLabel(
                      file.asset_category,
                      file.subcategory
                    );
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
                          <p className="flex items-center gap-1.5 text-xs text-ink-400">
                            {subLabel && <span>{subLabel}</span>}
                            {subLabel && <span>·</span>}
                            <span>
                              {file.size_bytes ? formatBytes(file.size_bytes) : "—"}
                            </span>
                            {isAdmin && !file.client_visible && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
                                <EyeOff className="h-3 w-3" /> Hidden
                              </span>
                            )}
                          </p>
                        </div>
                        {/* Always visible on touch devices; hover/focus reveal on desktop only. */}
                        <div className="flex items-center gap-1 transition-opacity lg:opacity-0 lg:focus-within:opacity-100 lg:group-hover:opacity-100">
                          <button
                            onClick={() => open(file)}
                            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                            aria-label="Download"
                          >
                            <Download className="h-4 w-4" />
                          </button>
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
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
