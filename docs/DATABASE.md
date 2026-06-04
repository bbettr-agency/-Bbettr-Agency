# Database & Supabase Notes

## Schema (8 tables)
Defined in `supabase/migrations/0001_initial_schema.sql`.

| Table | Purpose | Key columns |
|---|---|---|
| `clients` | Tenants | `status` (account lifecycle), contact fields |
| `profiles` | Links `auth.users` → role + tenant | `role`, `client_id` |
| `client_services` | Services a tenant purchased | `service`, `onboarding_status` |
| `onboarding_submissions` | Dynamic per-service form data | `data` (JSONB), `status` |
| `project_stages` | Delivery roadmap (source of truth) | `name`, `status`, `position` |
| `updates` | Project update feed | `title`, `body`, `published_at` |
| `reports` | Monthly performance reports | metrics + narrative, `pdf_path` |
| `files` | Metadata for Storage objects | `path`, `category` |

All tenant child tables are `ON DELETE CASCADE` from `clients(id)`.

## Row-Level Security (the isolation boundary)
Defined in `0002_rls_policies.sql`. Rule of thumb:
- **Admins** (`is_admin()`) — full access to everything.
- **Clients** — only rows where `client_id = current_client_id()`.

Clients have **write** access only to `onboarding_submissions` and `files`
(their own data). They are intentionally **read-only** on `client_services`,
`project_stages` and `clients`. Derived writes to those (onboarding status sync,
stage advancement, status changes) are performed **server-side with the
service-role client**, scoped to the authenticated `client_id`. This is why
`SUPABASE_SERVICE_ROLE_KEY` is required in production.

## Storage
`client-files` bucket (private). Objects live at `client-files/<client_id>/…`.
Policies match the first path segment to the user's tenant; admins see all.

## ⚠️ Required settings before/while live
1. **Public sign-up MUST be OFF** — Authentication → Providers → Email →
   disallow new sign-ups. The `handle_new_user` trigger trusts `role` from
   sign-up metadata; the only code path that sets it is the admin "Create
   client" action. With public sign-up on, anyone could self-register as admin.
2. Keep **RLS enabled** on every table (migrations do this — never disable it).
3. **Auth URLs** set to the production domain (see [DEPLOYMENT.md](./DEPLOYMENT.md)).

## Project lifecycle model (important)
Two independent concepts — don't conflate them:
- **`project_stages` + progress %** = the real **project progress** (source of
  truth). The client hero shows the current phase derived from this.
- **`clients.status`** = a manual **Account Status** lifecycle label (Lead →
  Onboarding → In Progress → Active → Paused → Completed). Internal/admin only;
  not shown to clients as project status. Cannot be set to *Completed* until the
  Launch stage is complete (soft guard).

## Default roadmap stages (created per client)
`Contract Signed → Onboarding Submitted → Assets Received → In Development →
Review Stage → Launch`. Some automation matches these exact names — renaming a
default stage disables that automation for that client.

## Seed data
`supabase/seed.sql` provides demo content for local dev. **Do not** run it in
production.
