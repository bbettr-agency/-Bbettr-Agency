"use client";

/**
 * Post-create "Grant Portal access now?" modal. Reuses the EXISTING
 * `provisionPortalAccessAction(clientId)` — the same action Intake uses — so both
 * flows share one provisioning/dup-guard/welcome-email implementation (no drift,
 * no second auth system). The new client already stored its contact_email, so the
 * action needs only the clientId.
 *
 * "Not now" closes and continues to the client — access can still be granted later
 * from Intake. If the client already has access (e.g. a legacy client created with
 * a password), the action's duplicate guard returns a friendly message rather than
 * creating a second user, and the modal surfaces it.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { provisionPortalAccessAction } from "@/app/(admin)/admin/actions";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the value is visible to copy manually */
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
      <code className="min-w-0 flex-1 break-all font-mono text-sm text-ink-800">{value}</code>
      <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Copy temporary password">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function GrantAccessModal({
  clientId,
  clientName,
  alreadyHasAccess,
  onClose,
}: {
  clientId: string;
  clientName: string;
  alreadyHasAccess: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; password?: string; error?: string } | null>(null);

  function goToClient() {
    onClose();
    router.push(`/admin/clients/${clientId}`);
  }

  function grant() {
    startTransition(async () => {
      const res = await provisionPortalAccessAction(clientId);
      setResult({ ok: !!res.ok, password: res.password, error: res.error });
    });
  }

  const title = "Client created";
  const description = `${clientName} was created successfully.`;

  return (
    <Modal open onClose={goToClient} title={title} description={description}>
      {alreadyHasAccess ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            Portal access was created together with this client. You can view and manage it from the client&rsquo;s Portal Access panel.
          </p>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={goToClient}>
              Go to client
            </Button>
          </div>
        </div>
      ) : result?.ok ? (
        <div className="space-y-4">
          {/* On email failure the action returns ok:true WITH an error note, so don't
              claim the email was sent — surface the note and let the admin share the
              temporary password manually. */}
          <p className="text-sm text-ink-600">
            Portal access granted{result.error ? "." : result.password ? " — a welcome email was sent." : "."}
          </p>
          {result.password ? (
            <>
              <p className="text-xs text-ink-500">Temporary password (shown once):</p>
              <CopyField value={result.password} />
            </>
          ) : null}
          {result.error ? <p className="text-xs text-amber-700">{result.error}</p> : null}
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={goToClient}>
              Go to client
            </Button>
          </div>
        </div>
      ) : result && !result.ok ? (
        <div className="space-y-4">
          <p className="text-sm text-amber-800">{result.error ?? "Could not grant portal access."}</p>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={goToClient}>
              Go to client
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            Would you like to grant Portal access now? This creates their login and emails a welcome message with a temporary password. You can also do this later from Intake.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={goToClient} disabled={pending}>
              Not now
            </Button>
            <Button type="button" size="sm" onClick={grant} loading={pending} aria-busy={pending || undefined}>
              Grant Portal Access
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
