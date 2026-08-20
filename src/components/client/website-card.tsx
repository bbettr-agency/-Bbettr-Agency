import { Globe, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deriveWebsiteState, hasWebsite } from "@/lib/website-state";

/**
 * Client Home "Your Website" card (Slice 2D). Reads the SAME clients columns the
 * admin manages (no duplicate URL). While the site is in development it offers a
 * preview link; once a live URL is set it becomes "Visit your website". Renders
 * nothing until there is a real URL — never a fake or disabled link.
 */
export function WebsiteCard({
  previewUrl,
  liveUrl,
}: {
  previewUrl: string | null;
  liveUrl: string | null;
}) {
  const v = deriveWebsiteState({ previewUrl, liveUrl });
  if (!hasWebsite(v)) return null;

  const live = v.state === "live";

  return (
    <Card className={live ? "border-emerald-200" : "border-brand-200"}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={
              live
                ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"
                : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white"
            }
          >
            <Globe className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">
              Your Website — {live ? "Live" : "In Development"}
            </p>
            <p className="text-sm text-ink-500">
              {live
                ? "Your website is live."
                : "Your website is currently being built — here’s a preview."}
            </p>
          </div>
        </div>
        <Button asChild variant={live ? "primary" : "outline"}>
          <a href={v.url} target="_blank" rel="noopener noreferrer">
            {live ? "Visit your website" : "View website preview"}
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
