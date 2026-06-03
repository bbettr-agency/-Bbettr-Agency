# Bbettr Agency Client Portal

A premium, multi-tenant client portal and agency operating system for **Bbettr Agency** (portal.bbettragency.com).

One application. Many clients. Each client sees only their own data. Administrators see everything.

Built with **Next.js (App Router) · TypeScript · Tailwind CSS · Supabase (Postgres + Auth + Storage)** and deployable to **Vercel**.

---

## ✨ Features (Phase 1 MVP)

### For Clients
- **Premium dashboard** — welcome hero, current services, live status and project progress.
- **Progress tracker** — a beautiful stage-by-stage timeline (Contract Signed → Launch).
- **Dynamic onboarding** — only the services a client purchased appear. Tailored forms for Website, Google Ads, Meta Ads and SEO.
- **File management** — securely upload logos, images, videos, PDFs, brand guides and documents.
- **Updates feed** — a project update timeline.
- **Monthly reports** — gorgeous report cards (ad spend, leads, CPL, clicks, impressions, conversion rate, narrative + PDF attachments).
- **Project progress** — current / completed / pending / upcoming work at a glance.

### For Administrators (Bbettr Agency team)
- **Agency overview** — total clients, active projects, pending onboardings, reports, updates and files.
- **Client management** — create clients (provisioning their tenant, services, default roadmap and login), and manage everything per client.
- **Per-client workspace** — view onboarding submissions, manage the project roadmap, post updates, create reports and review files.
- **Global views** — all reports, all updates and all files across every client.

---

## 🏗 Architecture

### Multi-tenancy

Tenancy is enforced at the **database layer** with PostgreSQL **Row-Level Security (RLS)** — the single source of truth for isolation, so a bug in the UI can never leak another tenant's data.

- Every tenant-scoped table has a `client_id`.
- `profiles` links each `auth.users` row to a `role` (`admin` | `client`) and a `client_id`.
- Two `SECURITY DEFINER` helpers power the policies:
  - `is_admin()` — true for admin users.
  - `current_client_id()` — the caller's tenant.
- Policy rule of thumb: **admins can do everything; clients can only touch rows where `client_id = current_client_id()`.**
- Supabase **Storage** is scoped the same way: files live under `client-files/<client_id>/…` and storage policies match the first path segment against the user's tenant.

### Project structure

```
src/
  app/
    (auth)/            login, forgot-password, reset-password
    (client)/          client portal  → /dashboard/*
    (admin)/           admin OS        → /admin/*
    auth/signout/      sign-out route handler
  components/
    ui/                design system (button, card, badge, table, tabs, …)
    layout/            app shell + navigation
    brand/             logo
    onboarding/        dynamic onboarding renderer
    reports/ updates/ files/ admin/   feature components
  lib/
    supabase/          browser, server, admin & middleware clients
    services.ts        service catalog + dynamic onboarding definitions
    queries.ts         tenant-scoped data access
    admin-queries.ts   cross-tenant admin data access
    auth.ts            role-gated session helpers
    database.types.ts  typed schema contract
supabase/
  migrations/          0001 schema · 0002 RLS · 0003 storage
  seed.sql             demo tenant + content
```

---

## 🎨 Design system

A consistent, premium design system spans the whole app:

- **Brand colour** `#38B6FF` (the `brand` palette), deep-ink neutrals, and accent tones.
- **Typography** — Inter (body) + Sora (display).
- Reusable primitives: `Button`, `Card`, `Badge`, `StatusBadge`, `Input/Textarea/Select`, `Table`, `Tabs`, `Modal`, `Avatar`, `ProgressTracker`, `StatCard`, `EmptyState`, `PageHeader`.
- Smooth animations, mobile-responsive layouts, glass surfaces and a custom scrollbar.

---

## 🚀 Getting started

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

In the [Supabase dashboard](https://supabase.com/dashboard), create a project and run the SQL in order:

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_rls_policies.sql`
3. `supabase/migrations/0003_storage.sql`
4. *(optional)* `supabase/seed.sql` for demo data

Or, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push      # applies migrations
```

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # server-only, used to provision client logins
NEXT_PUBLIC_APP_URL=https://portal.bbettragency.com
```

### 4. Create your first admin

Create a user in **Supabase → Authentication → Users**, then promote them:

```sql
update profiles set role = 'admin' where email = 'you@bbettragency.com';
```

> New users get a `profiles` row automatically via the `on_auth_user_created` trigger. Clients created through the admin UI are provisioned with `role = 'client'` and the correct `client_id` from their invite metadata.

### 5. Run

```bash
npm run dev      # http://localhost:3000
```

Admins land on `/admin`, clients on `/dashboard` — routing is role-aware.

---

## 🔒 Required security settings before go-live

> **⚠️ CRITICAL — disable public sign-up.** New `auth.users` get a `profiles` row
> via the `handle_new_user` trigger, which reads `role` and `client_id` from the
> user's sign-up metadata. This is safe because the **only** code path that sets
> that metadata is the admin "Create client" server action (gated by
> `requireAdmin()`). **But if public sign-up is left enabled, anyone could
> register themselves and request `role: admin`.**
>
> In the Supabase dashboard:
> 1. **Authentication → Providers → Email** → turn **OFF** "Allow new users to sign up"
>    (i.e. disable public sign-ups). All client logins are created by admins from
>    inside the portal.
> 2. **Authentication → Providers → Email** → keep "Confirm email" on (the admin
>    create-client flow already sets `email_confirm: true`).
> 3. Keep RLS enabled on every table (the migrations do this — never disable it).
>
> The app cannot enforce this setting from code; it is a Supabase project
> configuration and **must be verified manually before launch.**

---

## 📦 Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |

---

## ☁️ Deployment (Vercel)

1. Push this repo to GitHub and import it into Vercel.
2. Add the environment variables from `.env.example` in the Vercel project settings.
3. Set the production domain to `portal.bbettragency.com`.
4. Deploy.

---

## 🧭 Roadmap (beyond Phase 1)

This is a foundation designed to grow into a full Bbettr Agency Operating System: team seats & granular roles, notifications & email digests, billing/invoicing, task management, approvals, white-label theming per client, and analytics integrations (Google Ads / GA4 / Meta) feeding reports automatically.

---

© Bbettr Agency. All rights reserved.
