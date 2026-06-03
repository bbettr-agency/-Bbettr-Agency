"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { deleteClientAction } from "@/app/(admin)/admin/actions";

export function DangerZone({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = confirmText.trim() === clientName;

  function handleDelete() {
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteClientAction(clientId, confirmText);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/admin/clients?deleted=1");
      router.refresh();
    });
  }

  return (
    <>
      <Card className="border-red-200">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink-900">Danger Zone</h3>
              <p className="mt-0.5 max-w-xl text-sm text-ink-500">
                This will permanently remove the client, onboarding data, reports,
                updates, project stages, uploaded files and portal access. This
                action cannot be undone.
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            className="shrink-0"
            onClick={() => {
              setConfirmText("");
              setError(null);
              setOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete Client
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Delete Client?"
        description="This action cannot be undone."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Everything belonging to <strong>{clientName}</strong> will be
            permanently deleted, including their portal login.
          </div>

          <div>
            <Label htmlFor="confirm-name">
              Type the client name to continue:
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              autoComplete="off"
              placeholder={clientName}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!matches}
              loading={pending}
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" /> Delete Client
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
