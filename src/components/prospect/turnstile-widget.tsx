"use client";

import { useEffect, useRef } from "react";

/**
 * Minimal reusable Cloudflare Turnstile wrapper (P2-C scaffold for P2-D).
 *
 * Renders the managed widget (unobtrusive) via Cloudflare's script and hands the
 * resulting token to `onToken`. Only the PUBLIC site key is used here; the
 * secret is server-only. P2-D wires this into draft-creation + submission. If
 * the site key is unset it renders nothing (the server still fails closed).
 *
 * Kept intentionally small; the form does not depend on it rendering at all
 * times — callers request a token at the two protected moments only.
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

export function TurnstileWidget({
  onToken,
  onError,
}: {
  onToken: (token: string) => void;
  onError?: () => void;
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
        appearance: "interaction-only", // unobtrusive/managed
        callback: (token: string) => onToken(token),
        "error-callback": () => onError?.(),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, [onToken, onError]);

  if (!SITE_KEY) return null;
  return <div ref={ref} />;
}
