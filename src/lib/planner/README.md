# Planner module (internal, admin-only)

Part of the **Bbettr OS** integration — the internal operations Planner (tasks,
meetings, Google Calendar / Meet) merged into the Portal as an **admin-only**
module for the internal team. Built phase by phase per
`BBETTR_OS_IMPLEMENTATION_SPEC.md`.

## Ownership boundary

- **Consumes shared Portal services** (never forks them): `@/lib/auth`
  (`requireAdmin`), `@/lib/supabase/{server,client,admin}`,
  `@/components/layout/AppShell`, `@/components/ui/*`, `@/lib/utils`.
- **Planner-owned namespaces** (added in their phases): `@/lib/tasks/*`,
  `@/lib/google/*`, `@/lib/planner/*`, `@/components/planner/*`,
  `@/app/(admin)/admin/planner/*`, `@/app/api/google/*`.
- **Never touches** the Client Portal, Rep Portal, or their auth/navigation.

## Status

Phase 0 — scaffolding only (dependencies, feature flag, this namespace, env
documentation). No runtime code, no routes, no UI. Everything is gated by
`PLANNER_ENABLED` (`@/lib/flags`) and remains invisible until later phases.
