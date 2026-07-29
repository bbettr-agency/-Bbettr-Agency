# Integration Standard

Conventions every external integration in the Portal follows. Established with
QuickBooks and Google; new integrations mirror this pattern.

**Project invariant:** no external dependency may ever prevent the Portal from
loading or functioning. Every integration must fail independently — the Portal
stays usable when it is disconnected, times out, its OAuth expires, its token
refresh fails, or its APIs are unavailable.

## Folder structure

```
src/lib/net/                 Reusable transport + observability primitives (shared)
  http.ts                    fetchWithTimeout / fetchJsonWithTimeout
  retry.ts                   withRetry (bounded exponential backoff)
  errors.ts                  Generic IntegrationError family + isTransientIntegrationError
  log.ts                     Structured logging + correlation IDs
  index.ts                   Barrel export
src/lib/crypto/token-cipher.ts   Reusable AES-256-GCM token cipher (shared)

src/lib/<provider>/          One folder per integration
  config.ts                  getConfig(): Config | null   (env → config, null = inert)
  account.ts                 (if applicable) identity/account policy — one place, one rule
  connection.ts              Connection lifecycle: exchange, status, refresh, disconnect
  index.ts                   Public facade — the ONLY entry point other code imports

src/app/api/<provider>/connect/route.ts    OAuth start
src/app/api/<provider>/callback/route.ts   OAuth callback

src/components/admin/integration-card.tsx  Provider-agnostic card + view contract
src/app/(admin)/admin/integrations/
  providers.tsx              Provider definitions (per-provider view builders)
  page.tsx                   Pure renderer of the provider list
  actions.ts                 Server actions (e.g. disconnect)
```

Provider-specific code stays under `src/lib/<provider>/`. Shared mechanics
(transport, retry, errors, logging, crypto) live in `src/lib/net` and
`src/lib/crypto` — a new provider is their next consumer, never a re-implementer.

## Configuration

- All config comes from **server-only** environment variables, read through a
  single `getConfig()` that returns `Config | null`.
- **Missing/incomplete env ⇒ `null` ⇒ the integration is inert** and reports
  "not configured". It must never throw at import or block a render.
- Redirect URIs default to `${NEXT_PUBLIC_APP_URL}/api/<provider>/callback` and
  are overridable by an explicit env var.
- Internal modules are additionally gated by a server-side flag (e.g.
  `PLANNER_ENABLED`). Flags are on/off switches, never the security boundary.

## Secrets

- OAuth tokens are encrypted at rest with `src/lib/crypto/token-cipher`
  (AES-256-GCM, key = SHA-256(secret), stored `iv.tag.ciphertext` base64).
- Each provider has its own `*_TOKEN_SECRET` for independent rotation.
- Tokens are decrypted only in trusted server code immediately before use.
- Credential rows live in an **RLS-locked, service-role-only** table (RLS
  enabled + forced, no policies, privileges revoked from anon/authenticated).
  Never readable by the browser or any RLS-scoped session, including admins.
- Secrets are never logged, never placed in env-visible client bundles, never
  committed. Status reads must not pull ciphertext into memory needlessly.

## Timeout policy

- **Every** outbound call goes through `fetchWithTimeout` — no bare `fetch` in a
  provider module. Uses `AbortSignal.timeout`; default **10s**, tuned per call.
- Native `fetch` is used deliberately (not an SDK transport) to avoid RSC
  "ArrayBuffer is not detachable" failures and keep one transport everywhere.
- Status reads do **no network I/O**, so a UI render can never hang on a
  provider being slow or unreachable.

## Retry policy

- Transient failures (timeout, network, HTTP 429/5xx) are retried via
  `withRetry` — default 2 retries, exponential backoff (250ms · 2^n).
- Terminal failures are **never** retried: 4xx, `invalid_grant`, and
  single-use artifacts. In particular, an OAuth **authorization-code exchange is
  never retried** (the code is single-use).
- `isTransientIntegrationError` is the shared predicate.

## Logging

- Structured, one JSON line per event, via `logIntegrationEvent(level, fields)`.
- Trace these lifecycle events: `oauth_start`, `oauth_callback`,
  `token_exchange`, `token_refresh`, `disconnect`, `terminal_failure`.
- Fields carry `integration`, `event`, `correlationId`, `outcome`, and safe
  `status`/`reason` only — **never** tokens, codes, secrets, or response bodies.
- Logging must never throw into a flow.

## Correlation IDs

- `newCorrelationId()` mints one id per flow.
- OAuth start generates the id and stores it in an httpOnly cookie alongside the
  CSRF `state`; the callback reads it back so **start → callback → token
  exchange** share one id end to end.
- Server-side refresh/disconnect generate their own id when none is supplied.

## Typed errors

Generic, provider-agnostic, in `src/lib/net/errors.ts` (each carries the
`integration` slug; none carries a secret):

- `IntegrationConfigError` — not configured (inert).
- `IntegrationTimeoutError` — deadline exceeded.
- `IntegrationNetworkError` — transport failure.
- `IntegrationApiError` — non-2xx (`status` + raw `body`).
- `IntegrationAuthError` — terminal auth failure (revoked/expired/wrong account);
  optional `code` (e.g. `"wrong_account"`) lets callers branch without matching
  on message text.

No raw exception may escape a provider module into a server component. Callers
catch the typed error and degrade gracefully.

## Status lifecycle

- Persisted status enum: **`connected` → `reconnect_required` → `disconnected`**.
- `getConnectionStatus()` is **best-effort and side-effect-free**: reads only the
  DB row, does no network I/O, and swallows every error into a safe
  `disconnected` result so the Integrations page always renders.
- Invariant: `status='connected'` ⇒ a usable token exists. The status reader and
  the writers that uphold this invariant stay co-located in `connection.ts`.
- A failed refresh (`invalid_grant`) flips the row to `reconnect_required` and
  throws `IntegrationAuthError` — it never crashes a render.

## Disconnect behaviour

- Disconnect **forgets the stored token** (`refresh_token_enc = null`) and sets
  `status = 'disconnected'` with audit fields (`disconnected_by/at`).
- Best-effort: returns `{ ok, error? }` rather than throwing into the UI.
- Business records created while connected (e.g. invoice numbers) are untouched —
  disconnect only forgets the OAuth link.

## Provider contract

- Each provider exposes a builder `(status) => IntegrationCardView | null` in
  `providers.tsx` (null hides the card). `IntegrationCardView` is the shared
  contract in `integration-card.tsx`.
- OAuth providers share the `oauthCardView` shape so the
  connect/reconnect/disconnect layout exists in exactly one place;
  diagnostics-only providers supply their own view.
- The public surface other code imports is the provider's `index.ts` facade —
  routes and actions never reach into submodules.

## UI expectations

- The Integrations page is a **pure renderer** of the provider list — no
  provider-specific logic in `page.tsx`.
- Cards render through the reusable `IntegrationCard` / `IntegrationNotice` /
  `IntegrationRow`. Status → badge (`Connected` / `Reconnect required` /
  `Not connected`, or provider-specific like `Live` / `Sandbox`).
- OAuth callbacks redirect back to `/admin/integrations?<provider>=<status>`;
  banner copy is keyed by provider in `page.tsx`.
- Every state is representable and safe: not configured, disconnected,
  reconnect required, connected — the page must render in all of them.
