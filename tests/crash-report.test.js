// tests/crash-report.test.js — v18.13.0 (#28)
//
// What a crash leaves in `activity`. Two promises are held here: no guest data reaches
// a node every account can read, and a loop cannot flood it.

import { describe, it, expect } from "vitest";
import { crashEntry, crashGate, framesOf, maskText, noteCrashView, crashView, MAX_PER_LOAD } from "../src/lib/crash-report.js";

const CTX = { where: "render", version: "18.13.0", view: "timeline", device: "Android · Chrome" };
const V8 = `TypeError: Cannot read properties of undefined (reading 'time')
    at Qx (https://megustastu-bookings.vercel.app/assets/index-BRzHs2so.js:1:123456)
    at async Object.run (https://megustastu-bookings.vercel.app/assets/index-BRzHs2so.js:2:88)
    at Array.map (<anonymous>)
    at https://megustastu-bookings.vercel.app/assets/WaPanel-Abc123.js:1:9`;
const boom = (message, stack, Type = TypeError) => {
  const e = new Type(message);
  e.stack = stack === undefined ? "" : stack;
  return e;
};

describe("maskText", () => {
  it("masks a phone, however it is written", () => {
    ["+34600123456", "+34 600 123 456", "600-123-456", "(600) 123 456", "600123"].forEach((p) => {
      expect(maskText("call " + p + " now"), p).toBe("call # now");
    });
  });
  it("leaves a short number alone", () => {
    expect(maskText("HTTP 500 at 20:30, table 12")).toBe("HTTP 500 at 20:30, table 12");
  });
  it("masks an address and a quoted value", () => {
    expect(maskText("no such user ana.g@example.com here")).toBe("no such user # here");
    expect(maskText(`Unexpected token 'A', "Ana Garcia" is not valid JSON`)).toBe(`Unexpected token 'A', "#" is not valid JSON`);
  });
  it("keeps a single-quoted property name, which is the useful half of a TypeError", () => {
    expect(maskText("Cannot read properties of undefined (reading 'time')")).toContain("'time'");
  });
  it("takes nothing at all", () => {
    expect(maskText(null)).toBe("");
    expect(maskText(undefined)).toBe("");
  });
});

describe("framesOf", () => {
  it("keeps the function and the location, without the origin", () => {
    expect(framesOf(V8)).toEqual([
      "Qx assets/index-BRzHs2so.js:1:123456",
      "async Object.run assets/index-BRzHs2so.js:2:88",
      "assets/WaPanel-Abc123.js:1:9",
    ]);
  });
  it("reads Safari's and Firefox's shape", () => {
    expect(framesOf("Qx@https://x.vercel.app/assets/index-a.js:1:44\n@https://x.vercel.app/assets/index-a.js:2:5")).toEqual([
      "Qx assets/index-a.js:1:44",
      "assets/index-a.js:2:5",
    ]);
  });
  it("drops a query string, as DEV's cache-busting one", () => {
    expect(framesOf("at App (http://localhost:5173/src/App.jsx?t=1761:45:6)")).toEqual(["App src/App.jsx:45:6"]);
  });
  it("keeps a six-digit column: the mask is for messages", () => {
    expect(framesOf(V8)[0]).toContain(":123456");
  });
  it("a line that is not a frame is dropped, whatever it holds", () => {
    expect(framesOf("Error: Ana Garcia +34600123456\n   more about Ana\nana@example.com\nat nothing")).toEqual([]);
  });
  it("a function name in strange characters loses the name and keeps the place", () => {
    expect(framesOf(`at "Ana" (https://x.app/assets/a.js:1:2)`)).toEqual(["assets/a.js:1:2"]);
  });
  it("is bounded", () => {
    const long = Array.from({ length: 40 }, (_, i) => "at f" + i + " (https://x.app/a.js:1:" + i + ")").join("\n");
    expect(framesOf(long)).toHaveLength(12);
  });
  it("takes nothing at all", () => {
    expect(framesOf(undefined)).toEqual([]);
  });
});

describe("crashEntry", () => {
  it("builds the entry, from an Error", () => {
    const r = crashEntry(boom("Cannot read properties of undefined (reading 'time')", V8), {
      ...CTX, componentStack: "\n    at Qx (https://x.app/assets/index-a.js:1:2)\n    at div",
    });
    expect(r.entry).toEqual({
      kind: "crash",
      auto: true,
      text: "crash in timeline: TypeError: Cannot read properties of undefined (reading 'time')",
      crash: {
        where: "render",
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'time')",
        version: "18.13.0",
        stack: "Qx assets/index-BRzHs2so.js:1:123456\nasync Object.run assets/index-BRzHs2so.js:2:88\nassets/WaPanel-Abc123.js:1:9",
        component: "Qx assets/index-a.js:1:2",
        view: "timeline",
        device: "Android · Chrome",
      },
    });
  });
  it("omits what it does not have, because set() throws on an undefined", () => {
    const { crash } = crashEntry(boom("x"), {}).entry;
    expect(crash).toEqual({ where: "error", name: "TypeError", message: "x", version: "unknown" });
    expect(JSON.stringify(crash)).not.toContain("undefined");
  });
  it("the text reads without a view", () => {
    expect(crashEntry(boom("x"), {}).entry.text).toBe("crash: TypeError: x");
  });
  it("nothing in the message reaches the entry unmasked", () => {
    const e = boom(`could not save Ana +34 600 123 456, "Ana Garcia", ana@example.com`, V8, Error);
    const json = JSON.stringify(crashEntry(e, CTX).entry);
    ["600", "Ana Garcia", "ana@example.com"].forEach((leak) => expect(json, leak).not.toContain(leak));
  });
  it("a stack's first line repeats the message, and is not kept", () => {
    const e = boom("secret 123456789", "Error: secret 123456789\n    at f (https://x.app/a.js:1:2)", Error);
    expect(JSON.stringify(crashEntry(e, CTX).entry)).not.toContain("123456789");
  });
  it("a rejected booking contributes nothing: its name is a guest's", () => {
    const booking = { id: "b1", name: "Ana Garcia", phone: "+34600123456", message: "window seat", stack: "x" };
    const r = crashEntry(booking, CTX);
    expect(r.entry.crash).toMatchObject({ name: "Error", message: "(not an Error)" });
    expect(JSON.stringify(r.entry)).not.toContain("Ana");
    expect(JSON.stringify(r.entry)).not.toContain("window seat");
  });
  it("reads a thrown string and number, and has a word for the rest", () => {
    expect(crashEntry("gone wrong", CTX).entry.crash.message).toBe("gone wrong");
    expect(crashEntry(42, CTX).entry.crash.message).toBe("42");
    [null, undefined, {}, [], true].forEach((t) => {
      expect(crashEntry(t, CTX).entry.crash.message, String(t)).toBe("(not an Error)");
    });
    expect(crashEntry(new Error(""), CTX).entry.crash.message).toBe("(no message)");
  });
  it("a name that is not a plain word is not believed", () => {
    const e = new Error("x");
    e.name = "Ana Garcia";
    expect(crashEntry(e, CTX).entry.crash.name).toBe("Error");
  });
  it("caps every length", () => {
    const r = crashEntry(boom("x".repeat(5000), V8), { ...CTX, view: "v".repeat(200), device: "d".repeat(200) });
    expect(r.entry.crash.message).toHaveLength(300);
    expect(r.entry.text.length).toBeLessThanOrEqual(160);
    expect(r.entry.crash.view).toHaveLength(60);
    expect(r.entry.crash.device).toHaveLength(60);
    Object.values(r.entry.crash).forEach((v) => expect(typeof v).toBe("string"));
  });
  it("stays inside the rule's bound with the longest stack it can keep", () => {
    const fn = "f".repeat(80);
    const long = Array.from({ length: 40 }, () => "at " + fn + " (https://x.app/" + "p".repeat(300) + ".js:1:2)").join("\n");
    const { crash } = crashEntry(boom("x", long), { ...CTX, componentStack: long }).entry;
    expect(crash.stack.length).toBeLessThanOrEqual(1500);
    expect(crash.component.length).toBeLessThanOrEqual(600);
  });
});

describe("noise", () => {
  it("the browser's own notes and a network blip are not crashes", () => {
    ["ResizeObserver loop completed with undelivered notifications.", "ResizeObserver loop limit exceeded",
      "Script error.", "Uncaught Script error.", "Failed to fetch", "Load failed",
      "NetworkError when attempting to fetch resource."].forEach((m) => {
      expect(crashEntry(m, CTX), m).toBe(null);
    });
    expect(crashEntry(boom("Failed to fetch"), CTX)).toBe(null);
  });
  it("a chunk that went missing is a real failure", () => {
    expect(crashEntry(boom("Failed to fetch dynamically imported module: https://x.app/assets/a.js"), CTX)).not.toBe(null);
  });
  it("an extension's error is not ours", () => {
    const e = boom("x", "Error: x\n    at f (chrome-extension://abcdef/content.js:1:2)", Error);
    expect(crashEntry(e, CTX)).toBe(null);
    const moz = boom("x", "f@moz-extension://abcdef/content.js:1:2", Error);
    expect(crashEntry(moz, CTX)).toBe(null);
  });
});

describe("crashGate", () => {
  it("writes a signature once", () => {
    const admit = crashGate();
    expect(admit("a")).toBe(true);
    expect(admit("a")).toBe(false);
    expect(admit("b")).toBe(true);
  });
  it("stops at five, and a repeat costs nothing against the five", () => {
    const admit = crashGate();
    const said = ["a", "a", "b", "c", "c", "d", "e", "f", "g"].map(admit);
    expect(said.filter(Boolean)).toHaveLength(MAX_PER_LOAD);
    expect(said).toEqual([true, false, true, true, false, true, true, false, false]);
  });
  it("each page load has its own", () => {
    const one = crashGate(), two = crashGate();
    one("a");
    expect(two("a")).toBe(true);
  });
  it("the same throw through two doors is one entry", () => {
    const e = boom("x", V8);
    const a = crashEntry(e, { ...CTX, where: "render" });
    const b = crashEntry(e, { ...CTX, where: "error" });
    expect(a.signature).toBe(b.signature);
  });
  it("two different places are two entries", () => {
    const a = crashEntry(boom("x", "at f (https://x.app/a.js:1:2)"), CTX);
    const b = crashEntry(boom("x", "at g (https://x.app/b.js:9:9)"), CTX);
    expect(a.signature).not.toBe(b.signature);
  });
});

describe("the view", () => {
  it("is what was last noted, and survives the tree that noted it", () => {
    noteCrashView("plan");
    expect(crashView()).toBe("plan");
    noteCrashView(null);
    expect(crashView()).toBe("");
  });
});
