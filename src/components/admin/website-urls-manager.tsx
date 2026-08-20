"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { setClientWebsiteUrlsAction } from "@/app/(admin)/admin/actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Admin management of the Bbettr-built website URLs (Slice 2D), shown in Work
 * alongside project settings. Preview = the in-development site; Live = the
 * production site. Empty clears a field. This is the single source the client
 * Home "Your Website" card reads — no URL is ever entered twice.
 *
 * NB: distinct from the client-supplied existing_website_url captured during
 * onboarding — that is the client's pre-existing site and is not touched here.
 */
export function WebsiteUrlsManager({
  clientId,
  previewUrl,
  liveUrl,
}: {
  clientId: string;
  previewUrl: string | null;
  liveUrl: string | null;
}) {
  const [preview, setPreview] = useState(previewUrl ?? "");
  const [live, setLive] = useState(liveUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setClientWebsiteUrlsAction(clientId, preview, live);
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs text-ink-400">
        The Bbettr project site. Preview is shown to the client while in
        development; once a Live URL is set, the client sees “Visit your
        website”. Leave a field blank to clear it.
      </p>

      <UrlField
        id="website_preview_url"
        label="Preview URL (in development)"
        value={preview}
        onChange={setPreview}
        placeholder="https://preview.example.com"
      />
      <UrlField
        id="website_live_url"
        label="Live URL (production)"
        value={live}
        onChange={setLive}
        placeholder="https://clientdomain.co.za"
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {saved && !error && <p className="text-sm text-emerald-600">Saved.</p>}

      <Button type="submit" variant="outline" loading={pending}>
        Save website URLs
      </Button>
    </form>
  );
}

function UrlField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const trimmed = value.trim();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {trimmed && (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            Open <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <Input
        id={id}
        type="url"
        inputMode="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
