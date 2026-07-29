import * as React from "react";
import { Plug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Provider-agnostic Integrations UI building blocks.
 *
 * The Integrations page renders reusable cards rather than special-casing each
 * provider: every integration supplies the same shape (title, status badge,
 * description, optional notices, optional detail rows, optional actions), and
 * this shell renders it consistently. New integrations get a card for free.
 */

export type IntegrationBadgeTone = "success" | "neutral" | "warning";

export interface IntegrationDetailRow {
  label: string;
  value: string;
  wide?: boolean;
}

export interface IntegrationCardProps {
  title: string;
  /** Status pill (e.g. Connected / Not connected / Live / Sandbox). */
  badge: { label: string; tone: IntegrationBadgeTone };
  icon?: React.ReactNode;
  description: React.ReactNode;
  /** Provider-specific notice blocks (warnings / info), pre-composed. */
  notices?: React.ReactNode;
  rows?: IntegrationDetailRow[];
  /** Provider-specific action area (connect / reconnect / disconnect). */
  actions?: React.ReactNode;
}

export function IntegrationCard({
  title,
  badge,
  icon,
  description,
  notices,
  rows,
  actions,
}: IntegrationCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon ?? <Plug className="h-4.5 w-4.5 text-brand-500" />}
          <CardTitle>{title}</CardTitle>
        </div>
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {typeof description === "string" ? (
          <p className="text-sm text-ink-600">{description}</p>
        ) : (
          description
        )}

        {notices}

        {rows && rows.length > 0 && (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <IntegrationRow key={row.label} {...row} />
            ))}
          </div>
        )}

        {actions}
      </CardContent>
    </Card>
  );
}

/** A single label/value detail row. */
export function IntegrationRow({ label, value, wide }: IntegrationDetailRow) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 " +
        (wide ? "sm:col-span-2" : "")
      }
    >
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="truncate font-medium text-ink-900">{value}</span>
    </div>
  );
}

/** A provider-agnostic inline notice (amber warning / neutral info). */
export function IntegrationNotice({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      {children}
    </div>
  );
}
