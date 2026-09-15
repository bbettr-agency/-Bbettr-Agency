"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updatePasswordAction, type ResetState } from "./actions";

/**
 * New-password form. Submits to the updatePasswordAction server action, which
 * runs under the recovery session established by /auth/confirm (no dependency on
 * a browser-stored PKCE verifier). Server enforces the rules; these client checks
 * are for immediate UX only.
 */
export function ResetPasswordForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(updatePasswordAction, {});

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      <div>
        <Label htmlFor="password" required>
          New password
        </Label>
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <div>
        <Label htmlFor="confirm" required>
          Confirm password
        </Label>
        <Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Update password
      </Button>
    </form>
  );
}
