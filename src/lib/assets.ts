import {
  FileSignature,
  Palette,
  FileText,
  Image as ImageIcon,
  Folder,
  PackageCheck,
  BarChart3,
  Receipt,
  type LucideIcon,
} from "lucide-react";

/**
 * Asset catalog — the single source of truth for the Files & Assets system:
 * the seven top-level categories, their client-friendly subcategories, which
 * categories clients may upload into, and display labels/icons.
 *
 * Storage + the `files.asset_category` enum mirror these keys. Client-upload
 * permission is enforced for real by RLS (migration 0019); this catalog drives
 * the UI and the server-side guard.
 */

export type AssetCategoryKey =
  | "contracts"
  | "branding"
  | "website_content"
  | "media"
  | "documents"
  | "deliverables"
  | "reports"
  | "invoices";

export interface SubcategoryDef {
  key: string;
  label: string;
}

export interface AssetCategoryDef {
  key: AssetCategoryKey;
  label: string;
  icon: LucideIcon;
  /** Whether clients may upload into this category (else admin-only). */
  clientCanUpload: boolean;
  subcategories: SubcategoryDef[];
}

const sub = (key: string, label: string): SubcategoryDef => ({ key, label });

export const ASSET_CATEGORIES: Record<AssetCategoryKey, AssetCategoryDef> = {
  contracts: {
    key: "contracts",
    label: "Contracts",
    icon: FileSignature,
    clientCanUpload: false,
    subcategories: [
      sub("service_agreement", "Service Agreement"),
      sub("signed_agreement", "Signed Agreement"),
      sub("nda", "NDA"),
      sub("addendum", "Addendum"),
    ],
  },
  branding: {
    key: "branding",
    label: "Branding",
    icon: Palette,
    clientCanUpload: true,
    subcategories: [
      sub("logo", "Logo"),
      sub("brand_guidelines", "Brand Guidelines"),
      sub("fonts", "Fonts"),
      sub("colour_palette", "Colour Palette"),
    ],
  },
  website_content: {
    key: "website_content",
    label: "Website Content",
    icon: FileText,
    clientCanUpload: true,
    subcategories: [
      sub("about_us", "About Us"),
      sub("service_documents", "Service Documents"),
      sub("team_information", "Team Information"),
    ],
  },
  media: {
    key: "media",
    label: "Media",
    icon: ImageIcon,
    clientCanUpload: true,
    subcategories: [
      sub("images", "Images"),
      sub("videos", "Videos"),
      sub("product_photos", "Product Photos"),
    ],
  },
  documents: {
    key: "documents",
    label: "Documents",
    icon: Folder,
    clientCanUpload: true,
    subcategories: [
      sub("pdf", "PDFs"),
      sub("word", "Word Documents"),
      sub("general", "General Files"),
    ],
  },
  deliverables: {
    key: "deliverables",
    label: "Deliverables",
    icon: PackageCheck,
    clientCanUpload: false,
    subcategories: [
      sub("website_deliverables", "Website Deliverables"),
      sub("final_files", "Final Files"),
      sub("launch_documents", "Launch Documents"),
    ],
  },
  reports: {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    clientCanUpload: false,
    subcategories: [
      sub("monthly", "Monthly Reports"),
      sub("advertising", "Advertising Reports"),
      sub("analytics", "Analytics Reports"),
    ],
  },
  // Admin-managed invoice PDFs. Intentionally excluded from ASSET_CATEGORY_ORDER
  // so invoices never surface in the Files manager/pages — they appear only in
  // the admin Billing tab and the client Invoices page.
  invoices: {
    key: "invoices",
    label: "Invoices",
    icon: Receipt,
    clientCanUpload: false,
    subcategories: [sub("invoice", "Invoice")],
  },
};

/** Stable display order for the categories. */
export const ASSET_CATEGORY_ORDER: AssetCategoryKey[] = [
  "contracts",
  "branding",
  "website_content",
  "media",
  "documents",
  "deliverables",
  "reports",
];

/** Categories a client is allowed to upload into. */
export function clientUploadCategories(): AssetCategoryDef[] {
  return ASSET_CATEGORY_ORDER.map((k) => ASSET_CATEGORIES[k]).filter(
    (c) => c.clientCanUpload
  );
}

/** All categories (admin upload). */
export function allCategories(): AssetCategoryDef[] {
  return ASSET_CATEGORY_ORDER.map((k) => ASSET_CATEGORIES[k]);
}

export function categoryLabel(key: string): string {
  return ASSET_CATEGORIES[key as AssetCategoryKey]?.label ?? key;
}

export function subcategoryLabel(category: string, sub: string | null): string | null {
  if (!sub) return null;
  const def = ASSET_CATEGORIES[category as AssetCategoryKey];
  return def?.subcategories.find((s) => s.key === sub)?.label ?? sub;
}

/** Server-side guard mirroring the RLS allowlist. */
export function clientMayUploadTo(category: string): boolean {
  return ASSET_CATEGORIES[category as AssetCategoryKey]?.clientCanUpload ?? false;
}

/** Sensible default category/subcategory inferred from a MIME type. */
export function inferAssetCategory(mime: string): {
  category: AssetCategoryKey;
  subcategory: string;
} {
  if (mime.startsWith("image/")) return { category: "media", subcategory: "images" };
  if (mime.startsWith("video/")) return { category: "media", subcategory: "videos" };
  if (mime === "application/pdf") return { category: "documents", subcategory: "pdf" };
  return { category: "documents", subcategory: "general" };
}
