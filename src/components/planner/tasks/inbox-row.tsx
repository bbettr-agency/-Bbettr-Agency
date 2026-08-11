import type { InboxRowView } from "./inbox-row-view";
import type { InboxRowTarget } from "./inbox-row-target";
import type { AssignChoices } from "./task-command-target";
import { InboxTriageControls } from "./inbox-triage-controls";

/**
 * One Inbox row. The title/metadata remain SERVER-RENDERED and presentational
 * (no client JS here); the only hydrating unit is the small per-row
 * `InboxTriageControls` island, which receives just the minimal command target
 * (never the full Task). Title is the primary line and truncates safely; a muted
 * secondary line shows the relative captured time and, when available, the
 * captured-by admin name. The `<time>` carries the machine-readable ISO and an
 * absolute label for assistive tech.
 *
 * Layout: a wrapping flex row keeps title/meta primary on the left and the
 * subordinate controls on the right; the controls' expanded schedule area and
 * feedback wrap to their own full-width line (`basis-full`) beneath, so a
 * collapsed row keeps its compact height.
 */
export function InboxRow({
  view,
  target,
  assign,
  clients,
}: {
  view: InboxRowView;
  target: InboxRowTarget;
  assign?: AssignChoices;
  clients?: { id: string; name: string }[];
}) {
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">{view.title}</p>
          <p className="text-xs text-ink-500">
            Captured{" "}
            <time dateTime={view.capturedAtISO} title={view.capturedAtLabel || undefined}>
              {view.capturedRelative}
            </time>
            {view.capturedBy ? <> · by {view.capturedBy}</> : null}
          </p>
        </div>
        <InboxTriageControls target={target} assign={assign} clients={clients} />
      </div>
    </li>
  );
}
