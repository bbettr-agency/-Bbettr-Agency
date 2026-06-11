"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Label } from "@/components/ui/input";
import { deleteRepAction } from "@/app/(admin)/admin/reps/actions";

/**
 * TESTING-ONLY permanent rep deletion. Testing-only behaviour. Restore
 * historical-data protection before production launch. The historical-data
 * guard has been TEMPORARILY removed, so this hard-deletes the rep AND all of
 * their sales history (deals, invoice requests, commissions) via cascade.
 */
export function RepDangerZone({
  repId,
  repName,
}: {
  repId: string;
  repName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = confirmText.trim() === repName;

  function handleDelete() {
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRepAction(repId, confirmText);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/admin/reps?deleted=1");
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
                Permanently delete this rep, their portal login, and all
                associated sales history (deals, invoice requests, commissions).
                This cannot be undone.
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
            <Trash2 className="h-4 w-4" /> Delete Rep
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title="Delete Rep?"
        description="This action cannot be undone."
      >
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
            <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Testing mode
            </p>
            <p className="mt-1.5 text-sm font-medium text-red-700">
              This will permanently delete the rep and all associated sales
              history, commissions, deals, and invoice requests.
            </p>
          </div>

          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <strong>{repName}</strong>, their portal login, and everything they
            own will be permanently deleted. This cannot be undone.
          </div>

          <div>
            <Label htmlFor="confirm-rep-name">
              Type the rep&rsquo;s name to continue:
            </Label>
            <Input
              id="confirm-rep-name"
              value={confirmText}
              autoComplete="off"
              placeholder={repName}
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
              <Trash2 className="h-4 w-4" /> Delete Rep
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
