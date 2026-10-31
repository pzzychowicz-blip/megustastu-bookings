// tests/first-render.test.js
//
// One render of the real `BookingApp` (v18.13.1), and the only time App.jsx runs
// under test: everything else reads its text. A `const` read above its declaration
// is a RENDER-time throw that blanks the whole app, and lint and build both pass
// over it. So this runs the body once, top to bottom: if nothing throws, no const
// was read above itself on that path.
//
// `tests/CLAUDE.md` sets the bar for exercising a component, and this meets it the
// same way `error-boundary.test.js` does: no jsdom and nothing mounted. It asks
// React's server renderer for a string, so EFFECTS DO NOT RUN. It says nothing
// about effect order, or about any throw an effect would make, and a domain hook's
// effects still need a walk on DEV.
//
// Firebase is mocked whole, so nothing here can reach a database.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// createPortal needs a real DOM node, and the server renderer has none to give it.
vi.mock("react-dom", async (actual) => ({ ...(await actual()), createPortal: () => null }));
vi.mock("firebase/app", () => ({ initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { email: "t@t" } }),
  onAuthStateChanged: () => () => {},
  signOut: () => {},
  signInWithEmailAndPassword: () => {},
  sendPasswordResetEmail: () => {},
}));
// Every export is a function answering a no-op, which is also what an unsubscribe
// looks like. `then` stays undefined so the module is not mistaken for a promise.
vi.mock("firebase/database", () => {
  const noop = () => () => {};
  return new Proxy({ __esModule: true }, {
    get: (_, key) => (key === "__esModule" ? true : key === "then" ? undefined : noop),
    has: () => true,
  });
});

// Only what the body touches while rendering.
const store = new Map();
const node = {
  style: {}, dataset: {}, classList: { add() {}, remove() {} },
  setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild() {},
};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = {
  documentElement: node, body: node, head: node, visibilityState: "visible", hidden: false,
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ ...node }), addEventListener() {}, removeEventListener() {},
};
globalThis.window = Object.assign(globalThis, {
  innerWidth: 1200, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { hostname: "localhost", search: "", href: "http://localhost/" },
});

describe("the first render of BookingApp", () => {
  // Imported here, not at the top: App.jsx reads these globals as it loads.
  it("runs the whole body and reaches the return", async () => {
    const { BookingApp } = await import("../src/App.jsx");
    const html = renderToString(createElement(BookingApp, { uid: "u1" }));
    // The skip link is in the return, so every statement above it ran without a throw.
    expect(html).toContain("Skip to bookings");
  }, 30000);
});
