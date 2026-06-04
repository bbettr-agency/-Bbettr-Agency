# Go-Live / Regression Testing Checklist

Run after any significant change or before announcing the portal. All 12 passed
at launch (2026-06-03).

## Pre-checks
- [ ] Vercel latest production deploy = the commit you intend to ship
- [ ] Supabase: public sign-up OFF; Auth URLs set to the production domain

## End-to-end smoke test
1. [ ] **Admin login** → lands on `/admin`
2. [ ] **Create Client** (real name + temp password, pick Website + Google Ads)
3. [ ] **Client login** (incognito) → lands on `/dashboard`; hero shows **Current phase**; services as chips; readiness checklist visible
4. [ ] **Complete onboarding**: submit Website → auto-advance to Google Ads → submit → redirect to dashboard; both show **Submitted**; progress advanced
5. [ ] **Admin** (refresh client): Onboarding **2/2**, Account Status **In Progress**, progress moved
6. [ ] **Admin → Progress → Mark Assets Received**: Assets Received completes, In Development starts, optional update posts
7. [ ] **Client dashboard**: phase = **In Development**, checklist gone, new update visible
8. [ ] **Admin posts Update + creates Report** → both appear on the client's Updates/Reports pages (verifies revalidation)
9. [ ] **Guard**: admin tries Account Status → **Completed** before Launch → blocked with warning
10. [ ] **Files**: client uploads a logo → shows in their Files; admin sees it in the client's Files tab
11. [ ] **Delete**: throwaway client → Danger Zone → type name → confirm → back to Clients list with success banner; counts drop
12. [ ] **Tenant isolation**: as a client, no access to other clients' data; `/admin` redirects away

## Production sanity
- [ ] Mobile/responsive looks right
- [ ] No console errors on `/dashboard` and `/admin`
