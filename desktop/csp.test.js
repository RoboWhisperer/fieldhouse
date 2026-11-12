const { test, expect } = require("bun:test");
const { cspFor } = require("./csp");

const ORIGIN = "http://127.0.0.1:43210";

test("the overlay can be framed by the app and runs its inline bootstrap", () => {
  const csp = cspFor(`${ORIGIN}/overlay`, ORIGIN);
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).toContain(`connect-src 'self' ws://127.0.0.1:43210`);
  expect(csp).not.toContain("frame-ancestors 'none'");
});

test("app pages remain un-frameable and cannot run inline scripts", () => {
  const csp = cspFor(`${ORIGIN}/`, ORIGIN);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
});

test("custom graphics keep the sidecar's sandboxed CSP", () => {
  expect(cspFor(`${ORIGIN}/gfx/abc/index.html`, ORIGIN)).toBeNull();
  expect(cspFor(`${ORIGIN}/gfx/_runtime.js`, ORIGIN)).toBeNull();
});

test("responses outside the sidecar origin are untouched", () => {
  expect(cspFor("https://example.com/page", ORIGIN)).toBeNull();
  expect(cspFor("not a url", ORIGIN)).toBeNull();
  expect(cspFor(`${ORIGIN}/`, null)).toBeNull();
});
