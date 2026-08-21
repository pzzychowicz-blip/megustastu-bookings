// tests/modal-stack.test.js — v17.14.0
//
// The pure core of the modal stack. What these guard is not "does a modal
// open" — it is the three properties the eighteen booleans could not hold:
// the SET of open surfaces, their declared ORDER, and the fact that every
// surface has a place in that order.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyModal, topModal, modalMap, MODAL_Z } from "../src/hooks/useModalStack.js";

const open = (stack, id, v) => applyModal(stack, id, v === undefined ? true : v);

describe("applyModal", () => {
  it("opens, closes, and is a no-op when closing what is not open", () => {
    const one = open([], "form");
    expect(modalMap(one)).toEqual({ form: true });
    const none = applyModal(one, "form", null);
    expect(none).toEqual([]);
    const already = applyModal(none, "form", false);
    expect(already).toBe(none);            // identity — no re-render
  });

  it("keeps push order", () => {
    let s = open([], "form");
    s = open(s, "manual", { id: "b1" });
    s = open(s, "discard", "manual");
    expect(s.map((e) => e.id)).toEqual(["form", "manual", "discard"]);
  });

  it("re-opening replaces the payload IN PLACE, not on top", () => {
    // setManualTarget(other) while the picker is open is a payload change, not
    // a new layer — moving it to the top would reorder the stack under the user.
    let s = open(open([], "form"), "manual", "a");
    s = applyModal(s, "manual", "b");
    expect(s.map((e) => e.id)).toEqual(["form", "manual"]);
    expect(modalMap(s).manual).toBe("b");
  });

  it("an identical payload returns the same reference", () => {
    const s = open([], "kitchen", "walkin");
    expect(applyModal(s, "kitchen", "walkin")).toBe(s);
  });

  it("supports the updater form, which ReminderEditor's setDraft uses", () => {
    const s = open([], "reminder", { id: "r1", draft: { text: "a" } });
    const next = applyModal(s, "reminder", (prev) => ({ ...prev, draft: { text: "b" } }));
    expect(modalMap(next).reminder.draft.text).toBe("b");
    expect(modalMap(next).reminder.id).toBe("r1");
  });

  it("a FALSY payload closes — 0 and \"\" are not usable as payloads", () => {
    // /code-review: the semantics the eighteen booleans already had (every mount
    // site read `!!confirmDel`), preserved rather than chosen — but silent, so
    // it is pinned. A future modal keyed on a numeric id would call
    // `setModalFns.x(0)` and simply never appear, with nothing to grep for.
    const open = applyModal([], "manual", "t1");
    expect(applyModal(open, "manual", 0)).toEqual([]);
    expect(applyModal(open, "manual", "")).toEqual([]);
    expect(applyModal(open, "manual", NaN)).toEqual([]);
    // The documented workaround: wrap it.
    expect(modalMap(applyModal([], "manual", { id: 0 })).manual).toEqual({ id: 0 });
  });

  it("an updater returning null closes", () => {
    const s = open([], "reminder", { id: "r1" });
    expect(applyModal(s, "reminder", () => null)).toEqual([]);
  });

  it("closing from the middle leaves the rest in order", () => {
    let s = open(open(open([], "form"), "manual"), "discard");
    s = applyModal(s, "manual", null);
    expect(s.map((e) => e.id)).toEqual(["form", "discard"]);
  });
});

describe("topModal — the declared z-order, not the push order", () => {
  it("is null on an empty stack", () => {
    expect(topModal([])).toBe(null);
  });

  it("picks the highest DECLARED rank regardless of push order", () => {
    // The discard confirm is raised BY the form, so it is pushed second; but
    // even pushed first it must still be the one Escape acts on.
    expect(topModal([{ id: "form" }, { id: "discard" }])).toBe("discard");
    expect(topModal([{ id: "discard" }, { id: "form" }])).toBe("discard");
  });

  it("reproduces the old hand-written Escape chain exactly", () => {
    // The chain as it stood in v17.13.0, top-first. Each entry must win against
    // every entry below it — this is the regression guard for the whole
    // refactor, since the chain itself no longer exists to be read.
    const chain = ["splitmenu", "discard", "reminder", "reminderdel", "settings",
      "history", "kitchen", "reshuffle", "cancel", "del", "prefpicker", "search",
      "block", "manual", "walkin", "week", "form"];
    for (let i = 0; i < chain.length; i++) {
      for (let j = i + 1; j < chain.length; j++) {
        expect(topModal([{ id: chain[j] }, { id: chain[i] }])).toBe(chain[i]);
        expect(topModal([{ id: chain[i] }, { id: chain[j] }])).toBe(chain[i]);
      }
    }
  });

  it("push order breaks a tie between equal ranks", () => {
    expect(topModal([{ id: "form" }, { id: "form" }])).toBe("form");
  });

  it("an UNDECLARED id never claims the top", () => {
    // Conservative direction: a modal added without a place in MODAL_Z is still
    // closable, it just cannot outrank a declared one. The next test is what
    // stops it staying undeclared.
    expect(topModal([{ id: "form" }, { id: "mystery" }])).toBe("form");
    expect(topModal([{ id: "mystery" }])).toBe("mystery");
  });
});

describe("MODAL_Z covers every surface App can open", () => {
  it("every modal id App reads has a place in the order, and vice versa", () => {
    // The property the eighteen booleans could not have: `showWaitlist` was
    // missing from the Escape chain, from `anyModal`, from the shortcut
    // suppression and from `inert`, and nothing anywhere said so. A surface
    // without a rank fails here.
    //
    // /code-review, twice over. The id pattern was `[a-z]+`, so an id with a
    // digit or a dash ("block2", "pref-picker") escaped the very check it exists
    // for — the `showWaitlist` failure again, in the guard against it. And it
    // scraped `setModalFor("x")`, which no longer exists now that the setters
    // are generated FROM MODAL_Z; generated setters make that direction
    // tautological, so the check that still bites is the READ side:
    // `modalOpen.<id>` with no rank yields no setter and no Escape action.
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const ids = new Set([
      ...[...app.matchAll(/\bmodalOpen\.([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
      ...[...app.matchAll(/\bsetModalFns\.([A-Za-z0-9_$]+)/g)].map((m) => m[1]),
    ]);
    expect(ids.size, "the modalOpen/setModalFns patterns still match").toBeGreaterThan(10);
    expect([...ids].sort()).toEqual([...MODAL_Z].sort());
  });

  it("every K.* the keyboard hook reads is actually in App's ctx", () => {
    // /code-review: adding `case "waitlist"` to escapeAction without adding
    // `setShowWaitlist` to the ctx made Escape on that panel throw
    // `K.setShowWaitlist is not a function` — the exact defect the stack exists
    // to remove, shipped in the commit that removes it. It survived because the
    // OLD chain had no waitlist branch, so the setter had never been needed.
    //
    // A `case` in escapeAction is only half a wiring. This is the other half,
    // and it is checkable: every property the hook reads off `K` must appear as
    // a key of the object App passes in. Nothing else in the app cross-checks
    // those two lists, which is why one of them was short.
    const kb = readFileSync(new URL("../src/hooks/useKeyboardShortcuts.js", import.meta.url), "utf8");
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    const used = [...new Set([...kb.matchAll(/\bK\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
    expect(used.length, "the K.* pattern still matches").toBeGreaterThan(20);

    const call = app.slice(app.indexOf("useKeyboardShortcuts({"));
    const ctxEnd = call.indexOf("\n  });");
    expect(ctxEnd, "could not find the end of App's ctx object").toBeGreaterThan(0);
    const ctx = call.slice(0, ctxEnd);
    const provided = new Set([...ctx.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));

    const missing = used.filter((k) => !provided.has(k));
    expect(missing, "read off K but never passed by App: " + missing.join(", ")).toEqual([]);
  });

  it("every id in MODAL_Z has an Escape action", () => {
    const kb = readFileSync(new URL("../src/hooks/useKeyboardShortcuts.js", import.meta.url), "utf8");
    const body = kb.slice(kb.indexOf("function escapeAction"), kb.indexOf("const MODAL_ENTER_ORDER"));
    expect(body.length).toBeGreaterThan(200);     // the anchor still resolves
    MODAL_Z.forEach((id) => {
      expect(body, "no Escape action for modal \"" + id + "\"").toContain('case "' + id + '":');
    });
  });
});
