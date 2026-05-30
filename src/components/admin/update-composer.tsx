"use client";

import { useState, useTransition } from "react";
import { Send, CheckCircle2 } from "lucide-react";
import { postUpdateAction } from "@/app/(admin)/admin/actions";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function UpdateComposer({ clientId }: { clientId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("client_id", clientId);
    startTransition(async () => {
      const res = await postUpdateAction(formData);
      if (res.error) setError(res.error);
      else {
        form.reset();
        setDone(true);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="u-title" required>
          Title
        </Label>
        <Input
          id="u-title"
          name="title"
          required
          placeholder="Google Ads Optimisation Completed"
        />
      </div>
      <div>
        <Label htmlFor="u-body" required>
          Update
        </Label>
        <Textarea
          id="u-body"
          name="body"
          required
          rows={4}
          placeholder="We completed keyword optimisation and added new conversion tracking…"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          <Send className="h-4 w-4" /> Post update
        </Button>
        {done && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Update posted
          </span>
        )}
      </div>
    </form>
  );
}
