# Deployment

Production is on **Vercel**, database/auth/storage on **Supabase**, domain
`portal.bbettragency.com`. This records the working setup so it can be
reproduced or onboarded by a new team member.

## Current production
- **Repo:** `bbettr-agency/-Bbettr-Agency`, default branch `main`
- **Host:** Vercel (auto-deploys on push to `main`)
- **Domain:** `portal.bbettragency.com`
- **Live commit:** `f7b0994`

## One-time setup (already done)

### 1. GitHub
Repo pushed to `main`.

### 2. Supabase
Run migrations in order in the SQL editor (or `supabase db push`):
1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_rls_policies.sql`
3. `supabase/migrations/0003_storage.sql`

Then create the first admin and **disable public sign-up** — see [DATABASE.md](./DATABASE.md).

### 3. Vercel
- Import the GitHub repo (framework auto-detected as Next.js).
- Add environment variables (all environments):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`  (secret)
  - `NEXT_PUBLIC_APP_URL=https://portal.bbettragency.com`
- Deploy.

### 4. Supabase Auth URLs
- **Site URL:** `https://portal.bbettragency.com`
- **Redirect URLs:** add `https://portal.bbettragency.com/reset-password`

### 5. Domain
Add `portal.bbettragency.com` in Vercel → Domains and point DNS as instructed.

## Day-to-day: shipping a change
```bash
cd ~/bbettr-portal
git checkout main && git pull origin main
# ...make changes... then:
npm run typecheck && npm run lint && npm run build
git add -A && git commit -m "…"
git push origin main          # Vercel auto-redeploys
```

Watch **Vercel → Deployments** for the build to go green.

## Rollback
Vercel keeps every deployment — use **Promote to Production** on a previous
green deployment to roll back instantly.
