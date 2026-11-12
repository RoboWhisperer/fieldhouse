// CSP hardening shared by the desktop shell.
// The app pages are never frameable. /overlay is the one exception: the Graphics view embeds it
// for live previews, and it runs a small inline bootstrap script. /gfx pages keep the stricter
// sandboxed CSP issued by the sidecar, so we must not overwrite those response headers.
const consoleCsp = (ws) => `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${ws}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
const overlayCsp = (ws) => `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${ws}; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`;

const wsOrigin = (origin) => origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

/** CSP for a response URL under the sidecar origin, or null when the response must be left untouched. */
function cspFor(url, origin) {
  let target;
  try { target = new URL(url); } catch { return null; }
  if (!origin) return null;
  let base;
  try { base = new URL(origin); } catch { return null; }
  if (target.origin !== base.origin) return null;
  if (target.pathname.startsWith("/gfx/")) return null;
  const ws = wsOrigin(base.origin);
  return target.pathname === "/overlay" ? overlayCsp(ws) : consoleCsp(ws);
}

module.exports = { cspFor, consoleCsp, overlayCsp };
