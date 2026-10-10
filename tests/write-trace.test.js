// v18.6.0 — the DEV-only trace of the parked queue (src/lib/write-trace.js),
// kept for one fault that was seen once (ROADMAP, "A parked write was seen
// stored without Retry"). Three things are held here: the ring keeps the
// newest entries, a click is named the way a person would name it, and none of
// it is in a build.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { pushTrace, clickLabel, traceWrite, startClickTrace, TRACE_MAX, TRACE_KEY } from "../src/lib/write-trace.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/assets");
const read = (p) => stripComments(readFileSync(join(ROOT, p), "utf8")).join("\n");

describe("the ring", () => {
  it("keeps the newest entries and drops the oldest past its size", () => {
    const list = [];
    for (let i = 0; i < 7; i++) pushTrace(list, { n: i }, 5);
    expect(list.map((e) => e.n)).toEqual([2, 3, 4, 5, 6]);
  });
  it("holds TRACE_MAX entries by default", () => {
    const list = [];
    for (let i = 0; i < TRACE_MAX + 3; i++) pushTrace(list, { n: i });
    expect(list).toHaveLength(TRACE_MAX);
    expect(list[0].n).toBe(3);
  });
});

describe("clickLabel", () => {
  const el = (tag, text, label) => ({
    tagName: tag, textContent: text,
    getAttribute: (n) => (n === "aria-label" ? label || null : null),
    closest() { return this; },
  });
  it("names the control by its label, else its text, cut to 60 characters", () => {
    expect(clickLabel(el("BUTTON", "  Retry \n now "))).toBe('button "Retry now"');
    expect(clickLabel(el("BUTTON", "", "More actions"))).toBe('button "More actions"');
    expect(clickLabel(el("BUTTON", "x".repeat(80)))).toBe('button "' + "x".repeat(60) + '"');
  });
  it("reads the nearest control when the click landed on something inside it", () => {
    const button = el("BUTTON", "Retry");
    const icon = { tagName: "svg", textContent: "", closest: () => button };
    expect(clickLabel(icon)).toBe('button "Retry"');
  });
  it("answers for a click on bare page and for no target", () => {
    const bare = { tagName: "DIV", textContent: "", getAttribute: () => null, closest: () => null };
    expect(clickLabel(bare)).toBe("div");
    expect(clickLabel(null)).toBe("");
  });
});

// Vitest runs with `import.meta.env.DEV` true, so these run the DEV path
// against a stand-in `window`.
describe("in DEV", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const fakeWindow = () => {
    const w = { listeners: [], addEventListener(type, fn, capture) { w.listeners.push([type, fn, capture]); } };
    vi.stubGlobal("window", w);
    vi.spyOn(console, "info").mockImplementation(() => {});
    return w;
  };
  it("logs a click at the capture phase, once however often it is started", () => {
    const w = fakeWindow();
    startClickTrace();
    startClickTrace();
    expect(w.listeners.map((l) => [l[0], l[2]])).toEqual([["click", true]]);
    const target = { tagName: "BUTTON", textContent: "Retry", getAttribute: () => null, closest() { return this; } };
    w.listeners[0][1]({ isTrusted: false, target });
    expect(w[TRACE_KEY]).toHaveLength(1);
    expect(w[TRACE_KEY][0]).toMatchObject({ kind: "click", trusted: false, target: 'button "Retry"' });
  });
  it("a Retry is logged with its caller and the clicks just before it", () => {
    const w = fakeWindow();
    startClickTrace();
    const target = { tagName: "BUTTON", textContent: "Retry", getAttribute: () => null, closest() { return this; } };
    w.listeners[0][1]({ isTrusted: true, target });
    traceWrite("retry", { labels: ["Ana"] });
    const entry = w[TRACE_KEY][1];
    expect(entry).toMatchObject({ kind: "retry", labels: ["Ana"] });
    expect(entry.clicksBefore).toHaveLength(1);
    expect(entry.clicksBefore[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} button "Retry"$/);
    expect(Array.isArray(entry.stack)).toBe(true);
    expect(console.info).toHaveBeenCalledTimes(1);
  });
  it("a script's click is marked as one", () => {
    const w = fakeWindow();
    startClickTrace();
    w.listeners[0][1]({ isTrusted: false, target: { tagName: "BUTTON", textContent: "Retry", getAttribute: () => null, closest() { return this; } } });
    traceWrite("retry", {});
    expect(w[TRACE_KEY][1].clicksBefore[0]).toMatch(/ SCRIPT button "Retry"$/);
  });
});

describe("none of it is in a build", () => {
  it("both entry points return at once outside DEV", () => {
    const src = read("src/lib/write-trace.js");
    ["export function traceWrite(kind, detail) {", "export function startClickTrace() {"].forEach((head) => {
      const at = src.indexOf(head);
      expect(at, head).toBeGreaterThan(-1);
      expect(src.slice(at + head.length).trimStart().startsWith("if (!import.meta.env.DEV) return;"), head).toBe(true);
    });
  });
  it("every call in usePersistence is behind the DEV flag, so its arguments go too", () => {
    const src = read("src/hooks/usePersistence.js");
    const calls = src.match(/traceWrite\(/g) || [];
    const guarded = src.match(/if\(import\.meta\.env\.DEV\) traceWrite\(/g) || [];
    // Four queue events: park, retry, discard, replay.
    expect(calls).toHaveLength(4);
    expect(guarded).toHaveLength(4);
    expect(src).toContain("if(import.meta.env.DEV) startClickTrace();");
  });

  const entry = existsSync(DIST) ? readdirSync(DIST).find((f) => /^index-.*\.js$/.test(f)) : null;
  it.runIf(entry)("no built chunk holds the trace's strings", () => {
    // String literals, which a minifier keeps: the window key and the console prefix.
    const markers = [TRACE_KEY, "[trace] "];
    const src = readFileSync(join(ROOT, "src/lib/write-trace.js"), "utf8");
    markers.forEach((m) => expect(src.includes(m), m + " is a real string in the source").toBe(true));
    const hits = readdirSync(DIST).filter((f) => f.endsWith(".js"))
      .filter((f) => markers.some((m) => readFileSync(join(DIST, f), "utf8").includes(m)));
    expect(hits).toEqual([]);
  });
});
