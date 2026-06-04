# Local Development Setup

## Prerequisites
- Node.js 20+ (project built/tested on Node 22)
- A Supabase project (see [DATABASE.md](./DATABASE.md))

## Steps
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in the four values (from Supabase → Project Settings → API):
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY        (server-only secret)
#   NEXT_PUBLIC_APP_URL

# 3. Run the dev server
npm run dev          # http://localhost:3000
```

## Scripts
| Script | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Quality gate before committing
Run all three — they must pass (this is what we verified for every change):
```bash
npm run typecheck && npm run lint && npm run build
```

## Notes
- `SUPABASE_SERVICE_ROLE_KEY` is required for admin operations (create/delete
  client logins, onboarding status sync). Keep it out of the browser — it's only
  used in server actions.
- A SessionStart hook (`.claude/hooks/session-start.sh`) installs deps
  automatically in Claude Code on the web.
