import { createClient } from "@/lib/supabase/client";
import { buildStoragePath } from "@/lib/utils";
import { inferAssetCategory, type AssetCategoryKey } from "@/lib/assets";
import { recordFileUploadActivity } from "@/lib/file-actions";
import type { FileCategory, FileRecord } from "@/lib/database.types";

export const STORAGE_BUCKET = "client-files";

/** Infer the legacy file category from a MIME type (kept for back-compat). */
export function inferCategory(mime: string): FileCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "document";
}

export interface UploadOptions {
  assetCategory: AssetCategoryKey;
  subcategory?: string | null;
  /** Admins may stage hidden files; clients always upload visibly. */
  clientVisible?: boolean;
}

/**
 * Upload a single file to the tenant's storage folder and record its metadata.
 * Runs in the browser under the user's RLS context, so a client can only write
 * into their own tenant folder AND only into client-allowed categories (enforced
 * by the files RLS insert policy). The upload is recorded on the client's
 * activity timeline (best-effort, server-side).
 */
export async function uploadClientFile(
  clientId: string,
  file: File,
  options: UploadOptions
): Promise<FileRecord> {
  const supabase = createClient();
  const assetCategory = options.assetCategory;
  const subcategory =
    options.subcategory ?? inferAssetCategory(file.type).subcategory;
  const path = buildStoragePath(clientId, file.name, assetCategory);

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("files")
    .insert({
      client_id: clientId,
      name: file.name,
      path,
      category: inferCategory(file.type), // legacy column, back-compat
      asset_category: assetCategory,
      subcategory,
      client_visible: options.clientVisible ?? true,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    // Roll back the orphaned object so a rejected insert (e.g. a client trying an
    // admin-only category) doesn't leave a stray file behind.
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  // Timeline event (best-effort; failure never blocks the upload).
  void recordFileUploadActivity(clientId, file.name, assetCategory);

  return data;
}

/** Create a short-lived signed URL for viewing/downloading a stored file. */
export async function getSignedUrl(path: string, expiresIn = 60 * 60) {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
