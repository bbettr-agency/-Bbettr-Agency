"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Copy,
  UserPlus,
  CheckCircle2,
  Send,
} from "lucide-react";
import {
  createRepAction,
  sendRepWelcomeEmailAction,
} from "@/app/(admin)/admin/reps/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldHelp } from "@/components/ui/input";

export function CreateRepForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // `password` is the credential we can email: the admin-typed one or the
  // generated temp password. It exists only in this session — never re-read.
  const [done, setDone] = useState<{ repId?: string; password?: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [welcome, setWelcome] = useState<{ ok: boolean; msg: string } | null>(
    null
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setWelcome(null);
    const formData = new FormData(e.currentTarget);
    const typedPassword = String(formData.get("password") ?? "");
    startTransition(async () => {
      const res = await createRepAction(formData);
      if (res.error && !res.ok) {
        setError(res.error);
        return;
      }
      if (res.error) setError(res.error); // non-fatal warning
      // Use the generated password if one was returned, else the admin-typed one.
      setDone({ repId: res.repId, password: res.password || typedPassword });
    });
  }

  function sendWelcome() {
    if (!done?.repId || !done.password) return;
    setWelcome(null);
    startTransition(async () => {
      const res = await sendRepWelcomeEmailAction(done.repId!, done.password!);
      setWelcome(
        res.error
          ? { ok: false, msg: res.error }
          : { ok: true, msg: "Welcome email sent with login credentials." }
      );
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
          {done.password ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-700">
                Temporary password (shown once)
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-sm text-ink-900 ring-1 ring-inset ring-amber-200">
                  {done.password}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(done.password!);
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
                Share securely, or send the welcome email below to deliver the
                login URL, email and this password to the rep.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              The rep can sign in with the password you set.
            </p>
          )}

          {done.password && done.repId && (
            <div>
              <Button variant="outline" loading={pending} onClick={sendWelcome}>
                <Send className="h-4 w-4" /> Send welcome email with credentials
              </Button>
              {welcome && (
                <p
                  className={`mt-2 flex items-center gap-1.5 text-sm ${
                    welcome.ok ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {welcome.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  {welcome.msg}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-amber-700">{error}</p>}
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/admin/reps">Go to reps</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDone(null);
                setError(null);
                setWelcome(null);
              }}
            >
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
