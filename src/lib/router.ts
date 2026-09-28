import { useSyncExternalStore } from "react";

// A tiny hash router: pages live at #/today, #/trades/abc, #/rules …
// Hash URLs work everywhere Debrief runs (the companion, GitHub Pages, a file
// server) with no server-side setup.

function current(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : "/";
}

function subscribe(fn: () => void) {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
}

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

export function useRoute(): Route {
  const raw = useSyncExternalStore(subscribe, current, () => "/");
  const [path, qs = ""] = raw.split("?");
  return { path, parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const target = `#${to.startsWith("/") ? to : `/${to}`}`;
  if (opts.replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (opts.replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function href(to: string): string {
  return `#${to.startsWith("/") ? to : `/${to}`}`;
}
