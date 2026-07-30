import { Video } from "lucide-react";

/** Renders the stored Meet URL (from Portal state) — never calls Google. */
export function MeetLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
    >
      <Video className="h-4 w-4" /> Join Google Meet
    </a>
  );
}
