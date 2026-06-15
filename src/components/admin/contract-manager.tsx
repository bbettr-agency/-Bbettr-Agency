"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Send,
  CheckCircle2,
  ExternalLink,
  Download,
  Trash2,
  FileSignature,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSignedUrl } from "@/lib/upload";
import {
  addContractAction,
  markContractSentAction,
  markContractSignedAction,
  attachContractFileAction,
  deleteContractAction,
} from "@/app/(admin)/admin/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FileDropzone } from "@/components/shared/file-dropzone";
import type { ContractView } from "@/lib/queries";

const STATUS_STYLES: Record<string, string> = {
  not_sent: "bg-ink-100 text-ink-600",
  sent: "bg-amber-50 text-amber-700",
  signed: "bg-emerald-50 text-emerald-700",
};
const STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  signed: "Signed",
};

export function ContractManager({
  clientId,
  contracts,
}: {
  clientId: string;
  contracts: ContractView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  }

  function addContract(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    setError(null);
    startTransition(async () => {
      const res = await addContractAction(formData);
      if (res?.error) setError(res.error);
      else {
        form.reset();
        router.refresh();
      }
    });
  }

  async function openPath(path: string) {
    try {
      const url = await getSignedUrl(path);
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open file.");
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={addContract} className="space-y-2 rounded-xl border border-ink-100 p-3">
        <Input name="title" placeholder="Contract title (e.g. Service Agreement)" required />
        <Input name="contract_url" placeholder="Link to agreement (optional)" />
        <div className="flex justify-end">
          <Button type="submit" variant="outline" loading={pending}>
            <Plus className="h-4 w-4" /> Add contract
          </Button>
        </div>
      </form>

      {contracts.length > 0 ? (
        <ul className="space-y-3">
          {contracts.map((c) => (
            <li key={c.id} className="rounded-xl border border-ink-100 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <FileSignature className="mt-0.5 h-4.5 w-4.5 text-brand-500" />
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{c.title}</p>
                    <span
                      className={cn(
                        "mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[c.status] ?? "bg-ink-100 text-ink-600"
                      )}
                    >
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => run(() => deleteContractAction(c.id, clientId))}
                  disabled={pending}
                  className="shrink-0 text-ink-300 transition-colors hover:text-rose-500"
                  title="Delete contract"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {c.contract_url && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={c.contract_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" /> Open Contract
                    </a>
                  </Button>
                )}
                {c.status !== "signed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={pending}
                    onClick={() => run(() => markContractSentAction(c.id, clientId))}
                  >
                    <Send className="h-4 w-4" /> Mark Sent
                  </Button>
                )}
                {c.status !== "signed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={pending}
                    onClick={() => run(() => markContractSignedAction(c.id, clientId))}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Mark Signed
                  </Button>
                )}
                {c.signedFile && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openPath(c.signedFile!.path)}
                  >
                    <Download className="h-4 w-4" /> Signed file
                  </Button>
                )}
              </div>

              {!c.signedFile && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-ink-400">
                    Upload signed contract
                  </p>
                  <FileDropzone
                    clientId={clientId}
                    assetCategory="contracts"
                    subcategory="signed_agreement"
                    clientVisible
                    multiple={false}
                    onUploaded={(rec) =>
                      run(() => attachContractFileAction(c.id, clientId, rec.id))
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-400">No contracts yet.</p>
      )}
    </div>
  );
}
