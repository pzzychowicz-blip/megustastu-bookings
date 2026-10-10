// tests/shortcuts.test.js
//
// v18.4.4 (ROADMAP #15). The letter, symbol and arrow shortcuts are a table,
// `SHORTCUT_LAYERS` in src/lib/shortcuts.js, read by the pure `resolveShortcut`.
// Until then they were about seventy `if`s inside a window listener, so their
// precedence — which key wins where — had never been run by a test.
//
// These are the precedence rules, one case each: what a key means depends on
// what is on top, and the table's ORDER is the answer. The move itself was
// checked another way (REFACTOR_LOG, v18.4.4): the old handler and the table
// were run side by side over 300,000 random keys and states per seed.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../scripts/strip-comments.mjs";
import { resolveShortcut, shortcutDocs, SHORTCUT_LAYERS, SHORTCUT_GATES, SUMMARY_KEY, WEEK_KEY } from "../src/lib/shortcuts";
import { todayStr, addDays } from "../src/lib/day";

const TODAY = todayStr();
const ENV = { sandbox: false, today: TODAY, settingsTabs: () => ["general", "reminders", "admin"] };

const booking = (id, extra) => Object.assign({ id, status: "confirmed", date: TODAY, tables: [], history: [] }, extra);

// A context with every handler recording its call, over the state given.
function ctx(state) {
  const calls = [];
  const K = new Proxy(Object.assign({
    anyModal: false, topModalId: null, view: "timeline", viewDate: TODAY, today: TODAY, nowMins: 600,
    bookings: [], listDay: [], selectedListId: null, form: null, editId: null, showPrefPicker: false,
    settingsTab: "general", appWidth: 1200, timelineZoom: 1, tlFollowZoom: 2, tlMaxZoom: 3,
    followNow: false, autoOptimizer: true, hasModule: () => false,
  }, state), {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => { calls.push([name, ...args]); };
    },
  });
  return { K, calls };
}
// Press a key: what was prevented, and what was called.
function press(key, state, opts) {
  const { K, calls } = ctx(state);
  const found = resolveShortcut({ key, shiftKey: !!(opts && opts.shift) }, K, Object.assign({}, ENV, opts && opts.env));
  if (found && found.act) found.act(K);
  return { prevented: !!(found && found.prevent), calls, none: found === null };
}

describe("the shortcut table", () => {
  it("is well-formed: every row has keys and a run, and one-character keys are lower case", () => {
    let rows = 0;
    SHORTCUT_LAYERS.forEach((layer) => {
      expect(typeof layer.name).toBe("string");
      layer.rows.forEach((row) => {
        rows++;
        expect(Array.isArray(row.keys) && row.keys.length > 0, layer.name).toBe(true);
        expect(typeof row.run, layer.name + ":" + row.keys[0]).toBe("function");
        // A one-character key is matched against the pressed key LOWER-CASED,
        // so an upper-case entry could never match.
        row.keys.filter((k) => k.length === 1).forEach((k) => expect(k, layer.name).toBe(k.toLowerCase()));
      });
    });
    expect(rows).toBeGreaterThanOrEqual(38);
  });

  it("a key nobody owns is not prevented", () => {
    expect(press("q").none).toBe(true);
    expect(press("Tab").none).toBe(true);
  });

  it("letters match in either case", () => {
    expect(press("n").calls).toEqual([["openNew"]]);
    expect(press("N").calls).toEqual([["openNew"]]);
  });
});

describe("global over a modal: Shift+D, Shift +/−, ?", () => {
  const overModal = { anyModal: true, topModalId: "history" };
  it("Shift+D toggles the theme with a modal open; plain D does not reach 'today' there", () => {
    expect(press("D", overModal, { shift: true }).calls).toEqual([["onToggleDark"]]);
    expect(press("d", overModal).none).toBe(true);
  });
  it("Shift with + = * widens the app and Shift with _ - narrows it, on every layout's key", () => {
    ["+", "=", "*"].forEach((k) => expect(press(k, overModal, { shift: true }).calls).toEqual([["onSetAppWidth", 1250]]));
    ["_", "-"].forEach((k) => expect(press(k, overModal, { shift: true }).calls).toEqual([["onSetAppWidth", 1150]]));
  });
  it("? opens Settings over anything", () => {
    expect(press("?", overModal).calls).toEqual([["setShowSettings", true]]);
  });
});

describe("Settings on top", () => {
  const settings = { anyModal: true, topModalId: "settings" };
  it("←/→ cycle the VISIBLE tabs and wrap", () => {
    expect(press("ArrowRight", Object.assign({ settingsTab: "general" }, settings)).calls).toEqual([["setSettingsTab", "reminders"]]);
    expect(press("ArrowRight", Object.assign({ settingsTab: "admin" }, settings)).calls).toEqual([["setSettingsTab", "general"]]);
    expect(press("ArrowLeft", Object.assign({ settingsTab: "general" }, settings)).calls).toEqual([["setSettingsTab", "admin"]]);
  });
  it("a tab that is no longer visible counts as the first", () => {
    expect(press("ArrowRight", Object.assign({ settingsTab: "vouchers" }, settings)).calls).toEqual([["setSettingsTab", "reminders"]]);
  });
  it("the arrows do not change the day behind Settings", () => {
    const r = press("ArrowLeft", settings);
    expect(r.calls.map((c) => c[0])).not.toContain("goToDate");
  });
  it("N adds a reminder on the Reminders tab only", () => {
    expect(press("n", Object.assign({ settingsTab: "reminders" }, settings)).calls).toEqual([["openNewReminder"]]);
    expect(press("n", Object.assign({ settingsTab: "general" }, settings)).none).toBe(true);
  });
  it("a modal above Settings takes the arrows away from it", () => {
    expect(press("ArrowRight", { anyModal: true, topModalId: "discard" }).none).toBe(true);
  });
});

describe("the booking form on top", () => {
  const form = { anyModal: true, topModalId: "form", form: { manualTables: [], preferredTables: [] } };
  it("A opens the table picker for the booking, or for a new one", () => {
    expect(press("a", Object.assign({}, form, { editId: "b1" })).calls).toEqual([["setManualTarget", "b1"]]);
    expect(press("a", form).calls).toEqual([["setManualTarget", "__new__"]]);
  });
  it("P opens the preferred-table picker", () => {
    expect(press("p", form).calls).toEqual([["setShowPrefPicker", true]]);
  });
  it("C clears hand-picked tables first", () => {
    const { K, calls } = ctx(Object.assign({}, form, { form: { manualTables: ["4"] } }));
    const found = resolveShortcut({ key: "c" }, K, ENV);
    found.act(K);
    expect(calls[0][0]).toBe("setForm");
    expect(calls[0][1]({ manualTables: ["4"], notes: "x" })).toEqual({ manualTables: [], notes: "x" });
    expect(calls[1]).toEqual(["setSwapAffected", null]);
  });
  it("C marks a placed booking cleared, once, and does nothing for an unplaced one", () => {
    const placed = [booking("b1", { _locked: true, tables: ["4"] })];
    const state = Object.assign({}, form, { editId: "b1", bookings: placed });
    const { K, calls } = ctx(state);
    resolveShortcut({ key: "c" }, K, ENV).act(K);
    expect(calls[0][1]({})).toEqual({ manualTables: [], _clearManual: true });
    expect(press("c", Object.assign({}, state, { form: { manualTables: [], _clearManual: true } })).none).toBe(true);
    expect(press("c", Object.assign({}, state, { bookings: [booking("b1")] })).none).toBe(true);
  });
  it("B books again only from a seated or completed booking; H needs history", () => {
    const done = booking("b1", { status: "completed", history: [{ at: 1 }] });
    const state = Object.assign({}, form, { editId: "b1", bookings: [done] });
    expect(press("b", state).calls).toEqual([["bookAgain", done]]);
    expect(press("h", state).calls).toEqual([["setShowHistory", true]]);
    const fresh = Object.assign({}, form, { editId: "b1", bookings: [booking("b1")] });
    expect(press("b", fresh).none).toBe(true);
    expect(press("h", fresh).none).toBe(true);
  });
  it("B and H are edit-only: on a NEW booking they do nothing", () => {
    expect(press("b", form).none).toBe(true);
    expect(press("h", form).none).toBe(true);
  });
  it("the form's keys do not fire through a modal above it", () => {
    const under = { anyModal: true, topModalId: "discard", form: { manualTables: ["4"] } };
    ["a", "p", "c", "b", "h"].forEach((k) => expect(press(k, under).none, k).toBe(true));
  });
});

describe("the preferred-table picker", () => {
  const picker = { anyModal: true, topModalId: "prefpicker", showPrefPicker: true, form: { preferredTables: ["6"], manualTables: ["4"] } };
  it("C clears the preferred tables, not the assigned ones", () => {
    const { K, calls } = ctx(picker);
    resolveShortcut({ key: "c" }, K, ENV).act(K);
    expect(calls.length).toBe(1);
    expect(calls[0][1]({ preferredTables: ["6"], manualTables: ["4"] })).toEqual({ preferredTables: [], manualTables: ["4"] });
  });
  it("C with nothing to clear is left alone", () => {
    expect(press("c", Object.assign({}, picker, { form: { preferredTables: [] } })).none).toBe(true);
  });
  it("no other letter gets past it, even with the form reported on top", () => {
    const state = Object.assign({}, picker, { topModalId: "form" });
    ["a", "p", "b", "h", "n", "t"].forEach((k) => expect(press(k, state).none, k).toBe(true));
  });
});

describe("with any modal open, the page's shortcuts are off", () => {
  it("N, W, T, /, the arrows, the zoom keys", () => {
    const state = { anyModal: true, topModalId: "week", view: "timeline" };
    ["n", "w", "t", "l", "p", "/", "ArrowLeft", "ArrowRight", "+", "-", "0", "f", "o", "r", "s", "m", "i", "x"].forEach((k) => {
      expect(press(k, state, { env: { sandbox: true } }).none, k).toBe(true);
    });
  });
});

describe("List view", () => {
  const day = [booking("a"), booking("b"), booking("c")];
  const list = { view: "list", listDay: day, bookings: day };
  it("↓ and ↑ move the focus ring and stop at the ends", () => {
    expect(press("ArrowDown", list).calls).toEqual([["setSelectedListId", "a"], ["bumpListFocus"]]);
    expect(press("ArrowUp", list).calls).toEqual([["setSelectedListId", "c"], ["bumpListFocus"]]);
    expect(press("ArrowDown", Object.assign({ selectedListId: "c" }, list)).calls[0]).toEqual(["setSelectedListId", "c"]);
    expect(press("ArrowUp", Object.assign({ selectedListId: "b" }, list)).calls[0]).toEqual(["setSelectedListId", "a"]);
  });
  it("on an empty day the arrows are taken and do nothing", () => {
    const r = press("ArrowDown", { view: "list", listDay: [] });
    expect(r.prevented).toBe(true);
    expect(r.calls).toEqual([]);
  });
  const focused = Object.assign({ selectedListId: "b" }, list);
  it("A, E act on the focused card", () => {
    expect(press("a", focused).calls).toEqual([["setManualTarget", "b"]]);
    expect(press("e", focused).calls).toEqual([["openEdit", day[1]]]);
  });
  it("S seats it, C completes it, Shift+C cancels it", () => {
    expect(press("s", focused).calls).toEqual([["updateStatus", "b", "seated"]]);
    expect(press("c", focused).calls).toEqual([["updateStatus", "b", "completed"]]);
    expect(press("C", focused, { shift: true }).calls).toEqual([["updateStatus", "b", "cancelled"]]);
  });
  it("a PENDING card takes S and C and does nothing; Shift+C still cancels", () => {
    const pend = [booking("b", { status: "pending" })];
    const state = { view: "list", listDay: pend, bookings: pend, selectedListId: "b" };
    ["s", "c"].forEach((k) => {
      const r = press(k, state);
      expect(r.prevented, k).toBe(true);
      expect(r.calls, k).toEqual([]);
    });
    expect(press("c", state, { shift: true }).calls).toEqual([["updateStatus", "b", "cancelled"]]);
  });
  it("S does not seat on a day whose close has passed", () => {
    const old = [booking("b", { date: addDays(TODAY, -1) })];
    const r = press("s", { view: "list", listDay: old, bookings: old, selectedListId: "b" });
    expect(r.prevented).toBe(true);
    expect(r.calls).toEqual([]);
  });
  it("D deletes through requestDelete, which carries the capability gate", () => {
    expect(press("d", focused).calls).toEqual([["requestDelete", "b"]]);
  });
  it("with no card focused, S toggles the Summary and D goes to today", () => {
    const r = press("s", list);
    expect(r.calls[0][0]).toBe("setSummaryOpen");
    expect(r.calls[0][1](false)).toBe(true);
    expect(press("d", list).calls).toEqual([["goToDate", TODAY]]);
  });
  it("a selection that is not on this day counts as none", () => {
    expect(press("d", Object.assign({ selectedListId: "zzz" }, list)).calls).toEqual([["goToDate", TODAY]]);
  });
  it("←/→ still change the day", () => {
    expect(press("ArrowRight", focused).calls).toEqual([["goToDate", addDays(TODAY, 1)]]);
  });
});

describe("global keys", () => {
  it("T, L, P go through App's view picker", () => {
    expect(press("t", { view: "plan" }).calls).toEqual([["goView", "timeline"]]);
    expect(press("l").calls).toEqual([["goView", "list"]]);
    expect(press("p").calls).toEqual([["goView", "plan"]]);
  });
  it("without one, they slide in the direction of the view order and set the view", () => {
    expect(press("t", { view: "plan", goView: undefined }).calls).toEqual([["bumpSlide", "mgt-view-in-left"], ["setView", "timeline"]]);
    expect(press("p", { view: "list", goView: undefined }).calls).toEqual([["bumpSlide", "mgt-view-in-right"], ["setView", "plan"]]);
    expect(press("l", { view: "list", goView: undefined }).calls).toEqual([["setView", "list"]]);
  });
  it("N, W, /, the Summary and Week keys", () => {
    expect(press("w").calls).toEqual([["openWalkin"]]);
    expect(press("/").calls).toEqual([["setShowSearch", true]]);
    expect(press(WEEK_KEY).calls).toEqual([["setShowWeek", true]]);
    expect(press(SUMMARY_KEY, { view: "plan" }).calls[0][0]).toBe("setSummaryOpen");
  });
  it("←/→ step the viewed day, and an unreadable day steps from today", () => {
    expect(press("ArrowLeft", { viewDate: "2026-03-29" }).calls).toEqual([["goToDate", "2026-03-28"]]);
    expect(press("ArrowRight", { viewDate: "2026-03-29" }).calls).toEqual([["goToDate", "2026-03-30"]]);
    expect(press("ArrowRight", { viewDate: "" }).calls).toEqual([["goToDate", addDays(TODAY, 1)]]);
  });
  it("I opens the inbox only when the whatsapp MODULE is on — the sandbox flag does not open it", () => {
    expect(press("i", { hasModule: (id) => id === "whatsapp" }).calls).toEqual([["setShowInbox", true]]);
    expect(press("i", { hasModule: () => false }, { env: { sandbox: true } }).none).toBe(true);
    expect(press("i", { hasModule: undefined }).none).toBe(true);
  });
  it("X opens the simulator only in a sandbox build — the module does not open it", () => {
    expect(press("x", {}, { env: { sandbox: true } }).calls).toEqual([["setShowSim", true]]);
    expect(press("x", { hasModule: () => true }).none).toBe(true);
  });
});

describe("Timeline only", () => {
  const other = { view: "timeline", viewDate: addDays(TODAY, 1) };
  it("the zoom keys clamp between 1 and the device's maximum", () => {
    const zin = press("+", { view: "timeline", tlMaxZoom: 3 }).calls[0];
    expect(zin[0]).toBe("setTimelineZoom");
    expect(zin[1](2.75)).toBe(3);
    expect(press("=", { view: "timeline" }).calls[0][1](1)).toBe(1.5);
    expect(press("-", { view: "timeline" }).calls[0][1](1.25)).toBe(1);
    expect(press("0", { view: "timeline" }).calls).toEqual([["setTimelineZoom", 1], ["setFollowNow", false]]);
  });
  it("they do nothing in the other views", () => {
    ["+", "-", "0", "f", "o", "r"].forEach((k) => expect(press(k, { view: "plan" }).none, k).toBe(true));
  });
  it("F turns follow-now on (zooming in to its zoom) and off, today only", () => {
    expect(press("f", { view: "timeline", followNow: false, timelineZoom: 1, tlFollowZoom: 2 }).calls)
      .toEqual([["setFollowNow", true], ["setTimelineZoom", 2]]);
    expect(press("f", { view: "timeline", followNow: false, timelineZoom: 3, tlFollowZoom: 2 }).calls).toEqual([["setFollowNow", true]]);
    expect(press("f", { view: "timeline", followNow: true }).calls).toEqual([["setFollowNow", false]]);
    expect(press("f", other).none).toBe(true);
  });
  it("O toggles the optimiser today; R asks to reshuffle only while it is off", () => {
    expect(press("o", { view: "timeline" }).calls[0][1](true)).toBe(false);
    expect(press("o", other).none).toBe(true);
    expect(press("r", { view: "timeline", autoOptimizer: false }).calls).toEqual([["setConfirmReshuffle", true]]);
    expect(press("r", { view: "timeline", autoOptimizer: true }).none).toBe(true);
    expect(press("r", Object.assign({ autoOptimizer: false }, other)).none).toBe(true);
  });
});

describe("the hook carries the decision out and decides nothing itself", () => {
  const hook = stripComments(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "hooks", "useKeyboardShortcuts.js"), "utf8")).join("\n");
  it("it compares the key itself for Escape and Enter only", () => {
    // A branch added back to the handler would run before, or instead of, the
    // table — and no test here would see it.
    const compared = [...hook.matchAll(/\bk===("[^"]*")/g)].map((m) => m[1]);
    expect(compared).toEqual(['"Escape"', '"Enter"']);
  });
  it("it hands over the sandbox constant, the wall clock's day and the visible tabs", () => {
    expect(hook).toContain("sandbox:WA_SANDBOX");
    expect(hook).toContain("today:todayStr()");
    expect(hook).toMatch(/settingsTabs:function\(\)\{return visibleTabs\(K\.can,K\.hasModule\)/);
    expect(hook).toContain("if(typing) return;");
  });
});

// ── The Shortcuts tab is drawn from the table (v18.4.5) ──────────────────────
// Settings → Shortcuts listed its keys by hand, held to the table by nothing.
// It reads `shortcutDocs()` now, so these hold the table to being listable.
describe("every key in the table is listed on the Shortcuts tab", () => {
  const docs = shortcutDocs();
  const rows = SHORTCUT_LAYERS.flatMap((l) => l.rows.map((r) => Object.assign({ layer: l.name }, r)));

  it("every row says how it is printed: keycaps and a label", () => {
    const bare = rows.filter((r) => !(Array.isArray(r.caps) && r.caps.length && r.caps.every((c) => typeof c === "string" && c) && typeof r.label === "string" && r.label));
    expect(bare.map((r) => r.layer + ":" + r.keys.join(","))).toEqual([]);
  });

  // /code-review: rows merge into one line only when they share the gate too,
  // or a gated key is listed wherever the ungated one is.
  it("a gated row does not join an ungated line with the same label", () => {
    const global = SHORTCUT_LAYERS.find((l) => l.name === "global");
    global.rows.push({ keys: ["q"], caps: ["Q"], label: "Jump to today", gate: "whatsapp", run: () => null });
    try {
      const lines = shortcutDocs().find((d) => d.title === "Navigation").rows.filter((r) => r.label === "Jump to today");
      expect(lines.map((r) => [r.keys, r.when])).toEqual([[["D"], undefined], [["Q"], "whatsapp"]]);
    } finally { global.rows.pop(); }
  });

  it("every layer is in exactly one section", () => {
    const placed = docs.flatMap((sec) => sec.layers);
    expect(placed.slice().sort()).toEqual(SHORTCUT_LAYERS.map((l) => l.name).sort());
  });

  it("every row's label is a line of its layer's section, carrying its caps and its gate", () => {
    rows.forEach((r) => {
      const sec = docs.find((d) => d.layers.includes(r.layer));
      const line = sec.rows.find((d) => d.label === r.label);
      expect(line, r.layer + ": " + r.label).toBeTruthy();
      r.caps.forEach((c) => expect(line.keys).toContain(c));
      expect(line.when).toBe(r.gate);
    });
  });

  it("rows sharing a label are one line: the two arrows, the two app-width keys", () => {
    const nav = docs.find((d) => d.title === "Navigation").rows;
    expect(nav.find((r) => r.label === "Previous / next day").keys).toEqual(["←", "→"]);
    expect(nav.find((r) => r.label === "Adjust app width (±50 px)").keys).toEqual(["⇧+", "⇧−"]);
    expect(new Set(nav.map((r) => r.label)).size).toBe(nav.length);
  });

  it("a gate is one of the two the table knows, and is what stops the key", () => {
    const gated = rows.filter((r) => r.gate);
    expect(gated.map((r) => r.gate).sort()).toEqual(["sandbox", "whatsapp"]);
    gated.forEach((r) => expect(typeof SHORTCUT_GATES[r.gate]).toBe("function"));
    const K = (on) => ({ hasModule: (id) => on && id === "whatsapp" });
    const env = (sandbox) => ({ sandbox, today: "2026-01-01", settingsTabs: () => [] });
    expect(resolveShortcut({ key: "i" }, K(false), env(true))).toBe(null);
    expect(resolveShortcut({ key: "i" }, K(true), env(false))).not.toBe(null);
    expect(resolveShortcut({ key: "x" }, K(true), env(false))).toBe(null);
    expect(resolveShortcut({ key: "x" }, K(false), env(true))).not.toBe(null);
  });

  it("a letter prints as its capital, so the cap on the tab is the key that is pressed", () => {
    rows.filter((r) => r.keys.every((k) => /^[a-z]$/.test(k)) && r.keys.length === 1).forEach((r) => {
      expect(r.caps, r.label).toEqual([(r.shift ? "⇧" : "") + r.keys[0].toUpperCase()]);
    });
  });
});
