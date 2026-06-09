"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, Check, Copy, UserPlus, CheckCircle2 } from "lucide-react";
import { createRepAction } from "@/app/(admin)/admin/reps/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp } from "@/components/ui/input";

export function CreateRepForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tempPassword?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createRepAction(formData);
      if (res.error && !res.ok) {
        setError(res.error);
        return;
      }
      if (res.error) setError(res.error); // non-fatal warning
      setDone({ tempPassword: res.password });
    });
  }

  if (done) {
    return (
      <Card className="border-emerald-200">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-semibold text-ink-900">Rep created</p>
          </div>
          {done.tempPassword ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-700">
                Temporary password (shown once)
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm text-ink-900 ring-1 ring-inset ring-amber-200">
                  {done.tempPassword}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(done.tempPassword!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-100"
                  aria-label="Copy password"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-amber-700">
                Share securely. The rep can sign in at the portal and change it.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              The rep can sign in with the password you set.
            </p>
          )}
          {error && <p className="text-sm text-amber-700">{error}</p>}
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/admin/reps">Go to reps</Link>
            </Button>
            <Button variant="outline" onClick={() => { setDone(null); setError(null); }}>
              Create another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="space-y-5 p-6">
          <h2 className="text-sm font-semibold text-ink-900">Rep details</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="full_name" required>
                Full Name
              </Label>
              <Input id="full_name" name="full_name" required placeholder="Jane Doe" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" />
            </div>
            <div>
              <Label htmlFor="email" required>
                Email (login)
              </Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div>
              <Label htmlFor="commission_rate">Commission Rate (%)</Label>
              <Input
                id="commission_rate"
                name="commission_rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                placeholder="0"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="password">Temporary Password</Label>
              <Input id="password" name="password" type="text" minLength={8} placeholder="Leave blank to auto-generate" />
              <FieldHelp>
                Leave blank and we&apos;ll generate one to copy. The rep can reset
                it later.
              </FieldHelp>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          <UserPlus className="h-4 w-4" /> Create rep
        </Button>
      </div>
    </form>
  );
}
