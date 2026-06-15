import { Mail, MessageCircle, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import type { SuccessManager } from "@/lib/success-manager";

/**
 * "Your Success Manager" card — a friendly, human point of contact. Settings-
 * backed (team_members); optional channels (WhatsApp / Calendly / photo) only
 * render when set. Presentation only.
 */
export function SuccessManagerCard({ manager }: { manager: SuccessManager }) {
  const waDigits = manager.whatsapp?.replace(/[^\d]/g, "");

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <CardTitle>Your Success Manager</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3.5">
          <Avatar name={manager.name} src={manager.photo_url} size="lg" />
          <div>
            <p className="text-base font-semibold text-ink-900">{manager.name}</p>
            {manager.role && (
              <p className="text-sm text-ink-500">{manager.role}</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {manager.email && (
            <ContactRow
              href={`mailto:${manager.email}`}
              icon={<Mail className="h-4 w-4" />}
              label={manager.email}
            />
          )}
          {waDigits && (
            <ContactRow
              href={`https://wa.me/${waDigits}`}
              icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}
              label="Message on WhatsApp"
              external
            />
          )}
          {manager.calendly_url && (
            <ContactRow
              href={manager.calendly_url}
              icon={<CalendarDays className="h-4 w-4 text-brand-500" />}
              label="Book a call"
              external
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ContactRow({
  href,
  icon,
  label,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex items-center gap-2.5 rounded-xl border border-ink-100 px-3 py-2.5 text-sm font-medium text-ink-700 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
    >
      {icon}
      <span className="truncate">{label}</span>
    </a>
  );
}
