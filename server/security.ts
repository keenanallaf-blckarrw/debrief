import type { MiddlewareHandler } from "hono";

// The companion listens only on your own computer (127.0.0.1), but web pages
// you visit can still try to call localhost. These checks make sure only the
// Debrief app itself can use it, so no website can spend your AI key or read
// your journal:
//   - the Host header must be localhost (blocks DNS-rebinding tricks);
//   - browsers mark requests from other sites "cross-site"; those are refused;
//   - any Origin header must be a localhost address;
//   - requests that change something must send JSON, which forces a browser
//     preflight that other sites can't pass.

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function isLocalHost(host: string | undefined): boolean {
  return Boolean(host && LOCAL_HOST.test(host));
}

export function isLocalOrigin(origin: string | undefined): boolean {
  return Boolean(origin && LOCAL_ORIGIN.test(origin));
}

export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (!isLocalHost(c.req.header("host"))) return c.json({ error: "This companion only answers requests from this computer." }, 403);
    if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "Requests from other websites are blocked." }, 403);
    const origin = c.req.header("origin");
    if (origin && !isLocalOrigin(origin)) return c.json({ error: "Requests from other websites are blocked." }, 403);
    const method = c.req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const type = c.req.header("content-type") ?? "";
      if (!type.toLowerCase().includes("application/json")) return c.json({ error: "Send JSON." }, 415);
    }
    await next();
  };
}
