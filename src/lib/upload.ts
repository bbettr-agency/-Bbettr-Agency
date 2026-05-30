import { createClient } from "@/lib/supabase/client";
import { buildStoragePath } from "@/lib/utils";
import type { FileCategory, FileRecord } from "@/lib/database.types";

export const STORAGE_BUCKET = "client-files";

/** Infer a sensible file category from a MIME type. */
export function inferCategory(mime: string): FileCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "document";
}

/**
 * Upload a single file to the tenant's storage folder and record its metadata
 * in the `files` table. Runs in the browser under the user's RLS context, so a
 * client can only ever write into their own tenant folder.
 */
export async function uploadClientFile(
  clientId: string,
  file: File,
  category?: FileCategory
): Promise<FileRecord> {
  const supabase = createClient();
  const path = buildStoragePath(clientId, file.name);

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
      category: category ?? inferCategory(file.type),
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: user?.id ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
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
