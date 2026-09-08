"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile integration for the public intake (P2-C scaffold, wired
 * in P2-D). Only the PUBLIC site key is used here; the secret is server-only and
 * the server ALWAYS re-verifies (and fails closed if unconfigured), so this
 * widget is purely a token producer for the two protected moments — generic
 * draft creation and final submit. Managed/invisible ("interaction-only"): the
 * prospect never sees a puzzle unless Cloudflare decides interaction is needed.
 *
 * `useTurnstile` owns a single hidden widget and exposes the latest token plus a
 * `reset()` that mints a FRESH token (Turnstile tokens are single-use and expire
 * ~300s, so we reset after consuming one and on expiry). If the site key is
 * unset, `configured` is false, no token is ever produced, and the server write
 * fails closed — the deployment posture requires this.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function ensureScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => resolve(), { once: true });
    document.head.appendChild(s);
  });
}

function TurnstileWidget({
  onToken,
  onExpire,
  onError,
  bindReset,
}: {
  onToken: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
  bindReset: (fn: () => void) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return; // not configured → render nothing (server fails closed)
    let cancelled = false;
    ensureScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onExpire(),
        "error-callback": () => onError(),
      });
      bindReset(() => {
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
    // Callbacks are stable (useCallback in the hook); intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="mt-2" />;
}

export interface TurnstileController {
  /** True when a site key is configured (a widget can produce tokens). */
  configured: boolean;
  /** Latest unused token, or null (not ready / expired / consumed / unconfigured). */
  token: string | null;
  /** Discard the current token and mint a fresh one. */
  reset: () => void;
  /** Render this once, anywhere (it is visually unobtrusive). */
  widget: React.ReactNode;
}

export function useTurnstile(): TurnstileController {
  const [token, setToken] = useState<string | null>(null);
  const resetRef = useRef<() => void>(() => {});

  const bindReset = useCallback((fn: () => void) => {
    resetRef.current = fn;
  }, []);
  const onToken = useCallback((t: string) => setToken(t), []);
  const onExpire = useCallback(() => setToken(null), []);
  const onError = useCallback(() => setToken(null), []);
  const reset = useCallback(() => {
    setToken(null);
    resetRef.current();
  }, []);

  const widget = (
    <TurnstileWidget onToken={onToken} onExpire={onExpire} onError={onError} bindReset={bindReset} />
  );

  return { configured: Boolean(SITE_KEY), token, reset, widget };
}
