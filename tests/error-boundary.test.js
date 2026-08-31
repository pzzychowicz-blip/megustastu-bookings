// tests/error-boundary.test.js
//
// Regression test for CT-2A-02 (v17.15.7 crash test, P1): the app had no error
// boundary anywhere, so React's contract for an uncaught render error — unmount
// the whole tree — turned any throw into an empty `#root`. A white screen on a
// tablet, mid-service.
//
// This repo has no jsdom and no testing-library, and does not want them (CLAUDE.md
// lists UI/component tests as out of scope). It does not need them here: an error
// boundary's two decisions are a static method and a `render()` that branches on
// one state field, and both can be exercised by constructing the class directly
// and reading the returned element tree. Nothing below mounts anything.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ErrorBoundary from "../src/components/ErrorBoundary.jsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(resolve(HERE, "../src/", rel), "utf8");

// Walk a returned element tree. React elements are plain objects, so this needs
// no renderer — which is the whole reason these assertions are possible here.
function findAll(node, pred, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) findAll(n, pred, out); return out; }
  if (pred(node)) out.push(node);
  if (node.props) findAll(node.props.children, pred, out);
  return out;
}
function textOf(node, out = []) {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out); return out; }
  if (node.props) textOf(node.props.children, out);
  return out;
}
// A boundary instance in whichever state we want to look at, without mounting.
function boundary(state, props) {
  const eb = new ErrorBoundary(props || {});
  eb.state = state;
  return eb;
}

// ── 1. it is actually a boundary ────────────────────────────────────────────

describe("ErrorBoundary is a real boundary", () => {
  it("implements getDerivedStateFromError", () => {
    // Without this React does not treat the component as a boundary at all, and
    // the class would sit in the tree looking like a fix while catching nothing.
    expect(typeof ErrorBoundary.getDerivedStateFromError).toBe("function");
  });

  it("implements componentDidCatch, so the component stack reaches the console", () => {
    // The stack is the only thing that says WHICH subtree threw, and it exists
    // nowhere else once the tree is gone. v17.10.2's render loop was found by
    // reading the console on an app that looked perfectly healthy.
    expect(typeof ErrorBoundary.prototype.componentDidCatch).toBe("function");
  });
});

// ── 2. what it makes of whatever was thrown ─────────────────────────────────

describe("getDerivedStateFromError", () => {
  const from = (e) => ErrorBoundary.getDerivedStateFromError(e);

  it("takes an Error's message", () => {
    expect(from(new Error("t.split is not a function"))).toEqual({
      hasError: true, message: "t.split is not a function",
    });
  });

  it("takes a bare thrown string", () => {
    // `throw "…"` is legal and happens; the message is the value itself.
    expect(from("something went wrong").message).toBe("something went wrong");
  });

  it("renders NOTHING for a nullish throw, rather than the word null", () => {
    // `String(null)` is the four characters "null". Printing "· null" under the
    // buttons would be the app volunteering a word that means nothing to the
    // person reading it.
    expect(from(null).message).toBe("");
    expect(from(undefined).message).toBe("");
    expect(from(new Error()).message).toBe("");
  });

  it("still flags the error even when it can say nothing about it", () => {
    // The important half: an empty message must never be mistaken for "fine".
    expect(from(null).hasError).toBe(true);
    expect(from(undefined).hasError).toBe(true);
  });

  it("falls back to the value for a throw with no message", () => {
    expect(from({ code: 42 }).message).toBe("[object Object]");
  });
});

// ── 3. what it renders ──────────────────────────────────────────────────────

describe("render", () => {
  it("passes children straight through when nothing has thrown", () => {
    // The boundary wraps the entire app, so on the happy path it must be
    // completely transparent — no wrapper element, no layout of its own.
    const kids = { marker: "the app" };
    expect(boundary({ hasError: false, message: "" }, { children: kids }).render()).toBe(kids);
  });

  it("replaces children with the recovery surface once it has caught", () => {
    const kids = { marker: "the app" };
    const out = boundary({ hasError: true, message: "boom" }, { children: kids }).render();
    expect(out).not.toBe(kids);
    expect(out.type).toBe("div");
  });

  it("offers BOTH recoveries, because they fail differently", () => {
    // Try again restarts without re-fetching, which is the cheap first move for
    // a transient cause; Reload re-fetches from the server and is what to reach
    // for when Try again bounces. Dropping either leaves a class of failure with
    // no way out. Neither RESUMES the session — see the test below.
    const out = boundary({ hasError: true, message: "boom" }, {}).render();
    const buttons = findAll(out, (n) => n.type === "button");
    expect(buttons).toHaveLength(2);
    const labels = buttons.map((b) => textOf(b).join("").trim());
    expect(labels).toEqual(["Try again", "Reload app"]);
    for (const b of buttons) expect(typeof b.props.onClick).toBe("function");
  });

  it("does not promise a continuity it cannot deliver", () => {
    // React unmounts the errored subtree, so clearing `hasError` is a FRESH
    // MOUNT: every useState in BookingApp returns to its initializer. Measured
    // on the dev server — the app was on 2026-09-07 in List view before the
    // crash and came back on today's date in Timeline after Try again.
    //
    // The first version of this copy said "Try again first — it keeps you on
    // the same day", which would have sent someone back to today mid-service
    // believing they were still on Saturday's sheet. This pins the absence of
    // that promise rather than the exact wording, because the wording is free
    // to change and the promise is not.
    const text = textOf(boundary({ hasError: true, message: "boom" }, {}).render()).join(" ");
    expect(text).not.toMatch(/same day|keeps you|where you left|your place/i);
    expect(text).toMatch(/return to today/i);
  });

  it("names the version, so a report from the floor is actionable", () => {
    const prev = globalThis.window;
    globalThis.window = { __MGT_BUILD__: { app: "MGT Bookings", version: "17.16.0" } };
    try {
      const text = textOf(boundary({ hasError: true, message: "boom" }, {}).render()).join(" ");
      expect(text).toContain("MGT Bookings 17.16.0");
      expect(text).toContain("boom");
    } finally {
      if (prev === undefined) delete globalThis.window; else globalThis.window = prev;
    }
  });

  it("still renders when there is no build signature to read", () => {
    // The signature is set by App.jsx at module scope. A failure early enough to
    // beat that is exactly when this surface matters most, so it must not throw.
    const prev = globalThis.window;
    globalThis.window = {};
    try {
      const text = textOf(boundary({ hasError: true, message: "" }, {}).render()).join(" ");
      expect(text).toContain("MGT Bookings");
    } finally {
      if (prev === undefined) delete globalThis.window; else globalThis.window = prev;
    }
  });

  it("moves focus to the panel instead of claiming to be a live region", () => {
    // A live region added to the DOM already holding its message announces
    // NOTHING (CLAUDE.md's live-region rule), and this surface is created
    // holding its message by definition. Focus is what actually tells a screen
    // reader the page changed, so the panel must be focusable and take a ref.
    const eb = boundary({ hasError: true, message: "boom" }, {});
    const panel = findAll(eb.render(), (n) => n.props && n.props.tabIndex === -1);
    expect(panel).toHaveLength(1);
    expect(panel[0].props.ref).toBe(eb.focusPanel);

    const focus = vi.fn();
    eb.focusPanel({ focus });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(() => eb.focusPanel(null)).not.toThrow();   // React calls it with null on unmount
  });
});

// ── 4. the two recoveries do what they say ──────────────────────────────────

describe("the recovery actions", () => {
  it("Try again clears the error so the same tree re-renders", () => {
    const eb = boundary({ hasError: true, message: "boom" }, {});
    const setState = vi.fn();
    eb.setState = setState;
    eb.retry();
    expect(setState).toHaveBeenCalledWith({ hasError: false, message: "" });
  });

  it("Reload app reloads", () => {
    const prev = globalThis.window;
    const reload = vi.fn();
    globalThis.window = { location: { reload } };
    try {
      boundary({ hasError: true, message: "boom" }, {}).reload();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete globalThis.window; else globalThis.window = prev;
    }
  });
});

// ── 5. it is mounted where it can catch ─────────────────────────────────────

describe("the boundary is wired into the tree", () => {
  const main = src("main.jsx");

  it("main.jsx imports it", () => {
    expect(main).toContain('from "./components/ErrorBoundary"');
  });

  it("it WRAPS <App/> — a boundary cannot catch its own siblings", () => {
    // React boundaries catch errors from their children only. Rendered beside
    // <App/> rather than around it, this file would exist, look right in review,
    // and catch nothing at all.
    const open = main.indexOf("<ErrorBoundary>");
    const app = main.indexOf("<App />");
    const close = main.indexOf("</ErrorBoundary>");
    expect(open).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(app);
  });

  it("App is not also rendered outside the boundary", () => {
    expect((main.match(/<App \/>/g) || []).length).toBe(1);
  });
});
