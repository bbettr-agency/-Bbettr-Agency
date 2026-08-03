import type { InboxRowView } from "./inbox-row-view";

/**
 * One Inbox row — display only. Server-rendered (no client JS, no interaction,
 * no badges, no buttons). Title is the primary line and truncates safely;
 * a muted secondary line shows the relative captured time and, when available,
 * the captured-by admin name. The `<time>` carries the machine-readable ISO and
 * an absolute label for assistive tech.
 */
export function InboxRow({ view }: { view: InboxRowView }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">{view.title}</p>
        <p className="text-xs text-ink-500">
          Captured{" "}
          <time dateTime={view.capturedAtISO} title={view.capturedAtLabel || undefined}>
            {view.capturedRelative}
          </time>
          {view.capturedBy ? <> · by {view.capturedBy}</> : null}
        </p>
      </div>
    </li>
  );
}
