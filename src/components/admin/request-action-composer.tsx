"use client";

import { useState, useTransition } from "react";
import { Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { requestClientActionAction } from "@/app/(admin)/admin/actions";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  { value: "file_approval", label: "File needs approval" },
  { value: "feedback", label: "Feedback required" },
  { value: "information", label: "Information needed" },
  { value: "blocking", label: "Blocking project progress" },
];

export function RequestActionComposer({ clientId }: { clientId: string }) {
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
      const res = await requestClientActionAction(formData);
      if (res.error) setError(res.error);
      else {
        form.reset();
        setDone(true);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2 text-amber-600">
        <AlertTriangle className="h-4.5 w-4.5" />
        <p className="text-sm font-semibold text-ink-900">
          Request action from client
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ra-category" required>
            Type
          </Label>
          <Select id="ra-category" name="category" defaultValue="file_approval">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ra-title" required>
            Title
          </Label>
          <Input
            id="ra-title"
            name="title"
            required
            placeholder="Approve homepage design"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ra-details">Details</Label>
        <Textarea
          id="ra-details"
          name="details"
          rows={3}
          placeholder="What do you need from the client, and by when?"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>
          <Send className="h-4 w-4" /> Send request
        </Button>
        {done && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Request sent &amp; emailed
          </span>
        )}
      </div>
    </form>
  );
}
