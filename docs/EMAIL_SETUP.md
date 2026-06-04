# Email Setup & Production Recommendation

## Current state (V1)
The portal uses **Supabase Auth's built-in email sender** for:
- **Send welcome email / Resend credentials** → passwordless magic-link access
  email (`signInWithOtp`)
- **Password reset email** → `resetPasswordForEmail`

The email layer is abstracted behind `PortalEmailService`
(`src/lib/email/`), so the provider can be swapped without touching any UI or
server-action code.

> **Note:** the temporary password is **never emailed** — it's only shown once
> in the admin UI and copyable via *Copy credentials* / *Copy login
> instructions*. Supabase stores only the password hash, so the plaintext can't
> be retrieved later; use *Reset password* to mint a new one.

## The problem: "email rate limit exceeded"
Supabase's **shared/built-in email sender is heavily rate-limited** (only a few
emails per hour on the default project sender). It is meant for development, not
production. Hitting *Send welcome email* / *Resend credentials* a few times
exhausts the hourly quota. This is **not** a duplicate-send bug — each click
sends exactly one email; the cap is the shared sender's.

### Where to check in Supabase
- **Authentication → Providers → Email**: Email provider **Enabled**; **Magic
  Link / Email OTP Enabled**; Confirm Email optional.
- **Authentication → Rate Limits**: shows the per-hour email cap. Raising it
  only helps if you've configured your own SMTP/provider.

### Built-in fallback (already in the app)
When email fails, the admin can still onboard a client manually via Portal
Access → **Copy login instructions** (portal URL + email + temporary password +
step-by-step), and **Reset password** to generate a shareable temp password
without sending any email.

## Recommended production setup: Resend + info@bbettragency.com

Two ways to use Resend — pick one:

### Option A (simplest): Resend as Supabase's custom SMTP
Keep using Supabase Auth emails, but send them through Resend's SMTP so they're
branded and not rate-limited by Supabase.
1. Create a [Resend](https://resend.com) account; verify the domain
   **bbettragency.com** (add the DNS records Resend provides: SPF, DKIM).
2. Supabase → **Project Settings → Authentication → SMTP Settings** → enable
   custom SMTP:
   - Host `smtp.resend.com`, Port `465` (SSL) or `587` (TLS)
   - Username `resend`, Password = your Resend API key
   - Sender: `Bbettr Agency <info@bbettragency.com>`
3. Customise the email templates under **Authentication → Email Templates**.
4. Raise the email rate limit under **Authentication → Rate Limits**.

This requires **no app code changes** — the magic-link/reset emails now ship via
Resend from info@bbettragency.com.

### Option B (fully branded): Resend API via our own email service
Send our own templated emails (welcome / resend / reset) directly through the
Resend API, independent of Supabase's email templates.
1. `npm install resend`; add `RESEND_API_KEY` to Vercel env.
2. Create `src/lib/email/resend-service.ts` implementing `PortalEmailService`
   (`send(kind, email)`), sending branded HTML from
   `Bbettr Agency <info@bbettragency.com>`.
   - For welcome/reset that require a Supabase auth link, generate it server-side
     with `admin.auth.admin.generateLink({ type, email })` and embed it in the
     branded email body.
3. Switch the provider in `src/lib/email/index.ts`:
   ```ts
   export function getEmailService(): PortalEmailService {
     return process.env.EMAIL_PROVIDER === "resend"
       ? resendService
       : supabaseEmailService;
   }
   ```
4. Set `EMAIL_PROVIDER=resend` in Vercel.

No UI or action changes needed — callers only depend on `PortalEmailService`.

### Recommendation
Start with **Option A** (fast, fixes the rate limit and brands the sender today),
then move to **Option B** when you want fully custom-designed Bbettr Agency
emails.
