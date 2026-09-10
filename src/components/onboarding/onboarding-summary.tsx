import { FileText } from "lucide-react";
import { presentOnboarding, type PresentedRow } from "@/lib/onboarding-present";
import type { ServiceType } from "@/lib/database.types";

/**
 * Read-only, schema-driven presentation of a submitted onboarding — a concise
 * client brief rather than a form/JSON dump. Renders bare grouped sections
 * (no outer card) so it drops cleanly inside the existing admin/client Card that
 * already carries the service name + status badge. Reuses portal typography and
 * spacing; human labels come from the schema (never uppercased raw keys).
 */
export function OnboardingSummary({
  service,
  data,
}: {
  service: ServiceType;
  data: Record<string, unknown> | null | undefined;
}) {
  const { sections, hasContent } = presentOnboarding(service, data);

  if (!hasContent) {
    return <p className="text-sm text-ink-400">No onboarding answers yet.</p>;
  }

  return (
    <div className="space-y-7">
      {sections.map((section) => (
        <section key={section.title}>
          <h4 className="font-display text-sm font-semibold text-ink-900">{section.title}</h4>
          {section.description && <p className="mt-0.5 text-xs text-ink-400">{section.description}</p>}
          <dl className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {section.rows.map((row) => (
              <div key={row.label} className={row.full ? "sm:col-span-2" : undefined}>
                <dt className="text-xs font-medium text-ink-500">{row.label}</dt>
                <dd className="mt-1 text-sm text-ink-900">
                  <RowValue row={row} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function RowValue({ row }: { row: PresentedRow }) {
  switch (row.kind) {
    case "email":
      return (
        <a href={`mailto:${row.text}`} className="font-medium text-brand-600 hover:text-brand-700">
          {row.text}
        </a>
      );
    case "tel":
      return (
        <a href={`tel:${(row.text ?? "").replace(/\s+/g, "")}`} className="font-medium text-brand-600 hover:text-brand-700">
          {row.text}
        </a>
      );
    case "url":
      return (
        <a
          href={normalizeHref(row.text ?? "")}
          target="_blank"
          rel="noopener noreferrer"
          className="break-words font-medium text-brand-600 hover:text-brand-700"
        >
          {row.text}
        </a>
      );
    case "color":
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className="h-4 w-4 rounded ring-1 ring-inset ring-ink-200"
            style={{ backgroundColor: isCssColor(row.text) ? row.text : undefined }}
            aria-hidden
          />
          <span>{row.text}</span>
        </span>
      );
    case "longtext":
      return <p className="whitespace-pre-wrap break-words leading-relaxed text-ink-800">{row.text}</p>;
    case "list":
      return (
        <ul className="flex flex-wrap gap-1.5">
          {(row.items ?? []).map((item, i) => (
            <li
              key={i}
              className="rounded-full bg-ink-50 px-2.5 py-0.5 text-xs font-medium text-ink-700 ring-1 ring-inset ring-ink-100"
            >
              {item}
            </li>
          ))}
        </ul>
      );
    case "files":
      return (
        <ul className="space-y-1">
          {(row.files ?? []).map((name, i) => (
            <li key={i} className="flex items-center gap-1.5 text-ink-800">
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
              <span className="break-words">{name}</span>
            </li>
          ))}
        </ul>
      );
    case "group":
      return (
        <div className="space-y-2">
          {(row.entries ?? []).map((entry, i) => (
            <div key={i} className="rounded-xl border border-ink-100 bg-ink-50/50 p-3">
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {entry.map((sub) => (
                  <div key={sub.label} className={sub.full ? "sm:col-span-2" : undefined}>
                    <dt className="text-[11px] font-medium text-ink-400">{sub.label}</dt>
                    <dd className="text-sm text-ink-900">
                      <RowValue row={sub} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      );
    default:
      return <span className="break-words">{row.text}</span>;
  }
}

function normalizeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
function isCssColor(v: string | undefined): boolean {
  if (!v) return false;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) || /^[a-z]+$/i.test(v.trim());
}
