import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface PortalSettingsValues {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
}

const DEFAULTS: PortalSettingsValues = {
  maintenanceMode: false,
  maintenanceMessage: null,
};

/**
 * Read the global portal settings (single-row table). Falls back to safe
 * defaults (maintenance OFF) if the row/table is unavailable, so a read failure
 * can never lock clients out.
 *
 * Wrapped in React `cache()` so repeated calls within one request (layout +
 * nested pages) share a single lookup. Per-request only — every new request
 * re-reads, so toggling maintenance mode still takes effect immediately.
 */
export const getPortalSettings = cache(
  async (): Promise<PortalSettingsValues> => {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("portal_settings")
        .select("maintenance_mode, maintenance_message")
        .eq("id", true)
        .maybeSingle();

      if (!data) return DEFAULTS;
      return {
        maintenanceMode: data.maintenance_mode ?? false,
        maintenanceMessage: data.maintenance_message ?? null,
      };
    } catch {
      return DEFAULTS;
    }
  }
);
