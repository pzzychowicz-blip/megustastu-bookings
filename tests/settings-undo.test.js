// v18.19.1 (Patryk): Settings → Layout's Undo history (src/lib/settings-undo.js).
// v18.20.0 (Patryk): one history for every tab. The Layout cases below are
// v18.19.1's, assertion for assertion; only the call shape changed (a step
// names its node, and `undoStep` reads the stored node through a function).
import { describe, it, expect } from "vitest";
import { stableKey, changedPaths, recordStep as recordAny, undoStep as undoAny, pillText, UNDO_CONFLICT } from "../src/lib/settings-undo";
import { describeStep as describeAny, describeLayoutStep as describeStep } from "../src/lib/settings-undo-labels";
import { sanitizeLayout } from "../src/hooks/useLayout";
import { DEFAULT_LAYOUT } from "../src/lib/constants";

const base = sanitizeLayout(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
function edit(fn) { const c = JSON.parse(JSON.stringify(base)); fn(c); return sanitizeLayout(c); }
function step(before, after) { return describeStep(before, after, changedPaths(before, after)); }
const LAYOUT = "settings/layout";
function recordStep(stack, before, after) { return recordAny(stack, { node: LAYOUT, tab: "layout", before, after }, describeAny); }
function undoStep(stack, current) { return undoAny(stack, function () { return current; }); }

describe("stableKey", () => {
  it("ignores object key order and keeps array order", () => {
    expect(stableKey({ a: 1, b: { c: 2, d: 3 } })).toBe(stableKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableKey([1, 2])).not.toBe(stableKey([2, 1]));
  });
  it("an echo with its map keys sorted, as RTDB returns it, reads as the same layout", () => {
    const caps = { "1|2": 5, "10|11": 4 };
    const sorted = { "10|11": 4, "1|2": 5 };
    expect(stableKey({ ...base, comboCaps: caps })).toBe(stableKey({ ...base, comboCaps: sorted }));
  });
});

describe("changedPaths", () => {
  it("names the leaf that changed", () => {
    const a = edit((c) => { c.tables[2].capacity = 6; });
    expect(changedPaths(base, a)).toEqual(["tables.2.capacity"]);
  });
  it("is empty for the same layout", () => { expect(changedPaths(base, edit(() => {}))).toEqual([]); });
});

describe("describeStep: what the pill says", () => {
  it("tables", () => {
    expect(step(base, edit((c) => { c.tables[2].capacity = 6; }))).toBe("Seat count of table " + base.tables[2].id + " changed");
    expect(step(base, edit((c) => { c.tables[0].zone = "indoor"; }))).toBe("Table " + base.tables[0].id + " moved indoors");
    expect(step(base, edit((c) => { c.tables.push({ id: "99", capacity: 2, zone: "outdoor" }); }))).toBe("Table 99 added");
    expect(step(base, edit((c) => { c.tables.splice(1, 1); }))).toBe("Table " + base.tables[1].id + " removed");
    expect(step(base, edit((c) => { const t = c.tables[0]; c.tables[0] = c.tables[1]; c.tables[1] = t; }))).toBe("Tables reordered");
  });
  it("the ordered rule lists: added, removed, reordered, one changed", () => {
    expect(base.priorities.bands.length).toBeGreaterThan(1);
    expect(step(base, edit((c) => { c.priorities.bands.reverse(); }))).toBe("Size rules reordered");
    expect(step(base, edit((c) => { c.priorities.bands[1].max += 1; }))).toBe("Size rule 2 changed");
    expect(step(base, edit((c) => { c.priorities.bands.pop(); }))).toBe("Size rule removed");
    expect(step(base, edit((c) => { c.kitchenLimit += 1; }))).toBe("Kitchen limit changed");
  });
});

describe("recordStep", () => {
  it("records a save, and a save that changed nothing returns the same stack", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    const s = recordStep([], base, a);
    expect(s).toHaveLength(1);
    expect(recordStep(s, a, a)).toBe(s);
  });
  it("taps on one stepper in a row are one step, keeping the oldest before", () => {
    const a = edit((c) => { c.kitchenLimit = 4; });
    const b = edit((c) => { c.kitchenLimit = 5; });
    const s = recordStep(recordStep([], base, a), a, b);
    expect(s).toHaveLength(1);
    expect(s[0].before).toBe(base);
    expect(s[0].after).toBe(b);
  });
  it("stepped back to where it started, the step is gone", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    expect(recordStep(recordStep([], base, a), a, base)).toEqual([]);
  });
  it("a tap on ANOTHER stepper is a new step", () => {
    const a = edit((c) => { c.kitchenLimit += 1; });
    const b = sanitizeLayout({ ...JSON.parse(JSON.stringify(a)), tables: a.tables.map((t, i) => (i === 0 ? { ...t, capacity: t.capacity + 1 } : t)) });
    expect(recordStep(recordStep([], base, a), a, b)).toHaveLength(2);
  });
});

describe("undoStep", () => {
  const a = edit((c) => { c.kitchenLimit += 1; });
  const b = edit((c) => { c.kitchenLimit += 1; c.tables[0].capacity += 1; });
  const stack = recordStep(recordStep([], base, a), a, b);
  it("takes back one step at a time, back to the start", () => {
    const one = undoStep(stack, b);
    expect(one.restore).toBe(a);
    const two = undoStep(one.rest, a);
    expect(two.restore).toBe(base);
    expect(two.rest).toEqual([]);
    expect(undoStep([], base)).toBeNull();
  });
  it("refuses when the stored layout is not what this device wrote", () => {
    const other = edit((c) => { c.tables[3].capacity += 2; });
    expect(undoStep(stack, other)).toEqual({ refuse: UNDO_CONFLICT, rest: [] });
    expect(UNDO_CONFLICT).toBe("Changed on another device, can't undo");
  });
  it("an echo differing only in key order is not another device", () => {
    // Every object's keys reversed, as a stand-in for RTDB's sorted echo.
    function flip(v) {
      if (Array.isArray(v)) return v.map(flip);
      if (v && typeof v === "object") { const o = {}; Object.keys(v).reverse().forEach((k) => { o[k] = flip(v[k]); }); return o; }
      return v;
    }
    const echo = flip(b);
    expect(JSON.stringify(echo)).not.toBe(JSON.stringify(b));
    expect(undoStep(stack, echo).restore).toBe(a);
  });
});

// v18.19.1 /code-review: a value another device set between two taps on one
// stepper must not vanish into the merge.
describe("recordStep across another device's change", () => {
  it("does not merge when this save does not start from the last one's after", () => {
    const a = edit((c) => { c.kitchenLimit = 4; });
    const remote = edit((c) => { c.kitchenLimit = 6; });
    const b = edit((c) => { c.kitchenLimit = 7; });
    const s = recordStep(recordStep([], base, a), remote, b);
    expect(s).toHaveLength(2);
    expect(s[1].before).toBe(remote);
    // …so taking the first step back is refused once the second is undone.
    expect(undoStep(s.slice(0, 1), remote)).toEqual({ refuse: UNDO_CONFLICT, rest: [] });
  });
});

// v18.20.0 (Patryk): one history across the dialog's nodes.
describe("one history, several nodes", () => {
  const G = "settings/general";
  const g0 = { currency: "€", undoSecs: 8 };
  const g1 = { currency: "€", undoSecs: 9 };
  const g2 = { currency: "€", undoSecs: 10 };
  const lay = edit((c) => { c.kitchenLimit = 4; });
  function rec(stack, node, before, after, tab) { return recordAny(stack, { node, tab: tab || "general", before, after }, describeAny); }

  it("taps on the same leaf of DIFFERENT nodes never merge", () => {
    const s = rec(rec([], LAYOUT, base, lay, "layout"), G, { kitchenLimit: 3 }, { kitchenLimit: 4 });
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.node)).toEqual([LAYOUT, G]);
  });
  it("taps on one control of one node still merge, across another node's step below", () => {
    const s = rec(rec(rec([], LAYOUT, base, lay, "layout"), G, g0, g1), G, g1, g2);
    expect(s).toHaveLength(2);
    expect(s[1].before).toBe(g0);
    expect(s[1].after).toBe(g2);
  });
  it("Undo restores each node's own before, newest first", () => {
    const s = rec(rec([], LAYOUT, base, lay, "layout"), G, g0, g1);
    const stored = { [LAYOUT]: lay, [G]: g1 };
    const one = undoAny(s, (n) => stored[n]);
    expect(one.node).toBe(G);
    expect(one.restore).toBe(g0);
    stored[G] = g0;
    const two = undoAny(one.rest, (n) => stored[n]);
    expect(two.node).toBe(LAYOUT);
    expect(two.restore).toBe(base);
  });
  it("a refusal drops only its own node's steps (Patryk)", () => {
    const s = rec(rec(rec([], G, g0, g1), LAYOUT, base, lay, "layout"), G, { ...g1, currency: "€" }, { ...g1, currency: "$" });
    const stored = { [LAYOUT]: lay, [G]: { ...g1, currency: "£" } };
    const r = undoAny(s, (n) => stored[n]);
    expect(r.refuse).toBe(UNDO_CONFLICT);
    expect(r.rest.map((x) => x.node)).toEqual([LAYOUT]);
    expect(undoAny(r.rest, (n) => stored[n]).restore).toBe(base);
  });
  it("the pill names the step's tab only while you are on another", () => {
    const st = { label: "Kitchen limit changed", tab: "layout" };
    const name = (id) => ({ layout: "Layout", general: "General" })[id];
    expect(pillText(st, "layout", name)).toBe("Kitchen limit changed");
    expect(pillText(st, "general", name)).toBe("Layout · Kitchen limit changed");
    expect(pillText(null, "general", name)).toBe("");
  });
});

// v18.20.0 (Patryk): the pill says the control's visible name and what happened.
describe("describeStep: Settings → General", () => {
  function say(node, before, after) { return describeAny(node, before, after, changedPaths(before, after)); }
  const day = { open: 13, close: 22, closed: false };
  const week = { 0: day, 1: day, 2: day, 3: day, 4: day, 5: day, 6: day };
  const H = { week, exceptions: {} };
  it("opening hours and special days", () => {
    expect(say("settings/operatingHours", H, { ...H, week: { ...week, 1: { ...day, open: 12 } } })).toBe("Monday's hours changed");
    expect(say("settings/operatingHours", H, { ...H, week: { ...week, 0: { ...day, closed: true } } })).toBe("Sunday's hours changed");
    const other = { open: 12, close: 23, closed: false };
    const varied = { ...week, 3: other };
    expect(say("settings/operatingHours", { ...H, week: varied }, H)).toBe("Wednesday's hours changed");
    const all = { 0: other, 1: other, 2: other, 3: other, 4: other, 5: other, 6: other };
    expect(say("settings/operatingHours", { ...H, week: varied }, { ...H, week: all })).toBe("Hours copied to all days");
    const ex = { from: "2026-12-24", to: "2026-12-26", closed: true };
    expect(say("settings/operatingHours", H, { ...H, exceptions: { a: ex } })).toBe("Special day added");
    expect(say("settings/operatingHours", { ...H, exceptions: { a: ex } }, H)).toBe("Special day removed");
    expect(say("settings/operatingHours", { ...H, exceptions: { a: ex } }, { ...H, exceptions: { a: { ...ex, note: "Xmas" } } })).toBe("Special day changed");
  });
  it("shifts, the optimiser and the booking defaults", () => {
    expect(say("settings/dayShifts", { split: 17, enabled: true }, { split: 17, enabled: false })).toBe("Shifts switched off");
    expect(say("settings/dayShifts", { split: 17, enabled: true }, { split: 18, enabled: true })).toBe("Afternoon / Evening split changed");
    expect(say("settings/optimizer", { cutoff: 15, autoSwitch: false }, { cutoff: 15, autoSwitch: true })).toBe("Auto-optimiser switched on");
    expect(say("settings/optimizer", { cutoff: 15, autoSwitch: true }, { cutoff: 16, autoSwitch: true })).toBe("Daily cutoff changed");
    const bd = { v: 1, tiers: [{ max: 2, dur: 90 }, { max: 4, dur: 120 }], restDur: 150, lateEnabled: true, lateWarnMin: 15 };
    expect(say("settings/bookingDefaults", bd, { ...bd, tiers: [{ max: 2, dur: 90 }, { max: 4, dur: 135 }] })).toBe("Booking duration 2 changed");
    expect(say("settings/bookingDefaults", bd, { ...bd, tiers: bd.tiers.slice(0, 1) })).toBe("Booking duration removed");
    expect(say("settings/bookingDefaults", bd, { ...bd, restDur: 165 })).toBe("Larger parties' stay changed");
    expect(say("settings/bookingDefaults", { ...bd, tiers: [] }, { ...bd, tiers: [], restDur: 165 })).toBe("All parties' stay changed");
    expect(say("settings/bookingDefaults", bd, { ...bd, lateEnabled: false })).toBe("Running late switched off");
    expect(say("settings/bookingDefaults", bd, { ...bd, lateWarnMin: 20 })).toBe("Highlight after changed");
  });
  it("general settings and standing bookings", () => {
    const gs = { v: 1, restaurantName: "Me Gustas Tú", currency: "€", undoSecs: 10, pinnedCountries: ["ES"] };
    expect(say("settings/general", gs, { ...gs, restaurantName: "MGT" })).toBe("Restaurant name changed");
    expect(say("settings/general", gs, { ...gs, undoSecs: 15 })).toBe("Undo toast time changed");
    expect(say("settings/general", gs, { ...gs, pinnedCountries: ["ES", "GB"] })).toBe("Pinned country added");
    expect(say("settings/general", gs, { ...gs, pinnedCountries: [] })).toBe("Pinned country removed");
    const r = { id: "r1", name: "Ana", active: true };
    const rec = { v: 1, enabled: true, horizonWeeks: 4, rules: [r] };
    expect(say("recurring", rec, { ...rec, enabled: false })).toBe("Standing bookings switched off");
    expect(say("recurring", rec, { ...rec, horizonWeeks: 6 })).toBe("Generate ahead changed");
    expect(say("recurring", rec, { ...rec, rules: [{ ...r, active: false }] })).toBe("Standing booking for Ana paused");
    expect(say("recurring", { ...rec, rules: [{ ...r, active: false }] }, rec)).toBe("Standing booking for Ana resumed");
    expect(say("recurring", rec, { ...rec, rules: [] })).toBe("Standing booking for Ana removed");
  });
});

describe("describeStep: Settings → Customers", () => {
  const L = { v: 1, guest: [{ id: "vip", label: "VIP" }], occasion: [{ id: "bday", label: "Birthday" }] };
  function say(node, before, after, ctx) { return describeAny(node, before, after, changedPaths(before, after), ctx); }
  it("the tag list", () => {
    expect(say("settings/tags", L, { ...L, guest: L.guest.concat([{ id: "nuts", label: "Nut allergy" }]) })).toBe("Tag “Nut allergy” added");
    expect(say("settings/tags", L, { ...L, occasion: [] })).toBe("Tag “Birthday” removed");
    expect(say("settings/tags", L, { ...L, guest: [{ id: "vip", label: "V.I.P." }] })).toBe("Tag “VIP” renamed");
  });
  it("a guest's tags, named by the guest and the tag as they were at the tap", () => {
    const ctx = { name: "Ana", labels: { vip: "VIP" } };
    expect(say("guestTags:34600111222", [], ["vip"], ctx)).toBe("VIP added for Ana");
    expect(say("guestTags:34600111222", ["vip"], [], ctx)).toBe("VIP removed from Ana");
    expect(say("guestTags:g1", [], ["vip"], { labels: { vip: "VIP" } })).toBe("VIP added");
  });
  it("taps on one guest's chip merge, and a merge keeps the first tap's context", () => {
    const ctx = { name: "Ana", labels: { vip: "VIP" } };
    const s1 = recordAny([], { node: "guestTags:k", tab: "customers", before: [], after: ["vip"], ctx }, describeAny);
    expect(s1[0].label).toBe("VIP added for Ana");
    expect(recordAny(s1, { node: "guestTags:k", tab: "customers", before: ["vip"], after: [], ctx: {} }, describeAny)).toEqual([]);
  });
});

describe("describeStep: Settings → Vouchers", () => {
  it("void, reinstate and the default validity", () => {
    expect(describeAny("voucher:A1B2C3", "open", "void", [""])).toMatch(/^Voucher .+ voided$/);
    expect(describeAny("voucher:A1B2C3", "void", "open", [""])).toMatch(/^Voucher .+ reinstated$/);
    expect(describeAny("settings/voucherDefaults", { v: 1, expiryMonths: 12 }, { v: 1, expiryMonths: 6 }, ["expiryMonths"])).toBe("Default validity changed");
  });
});

describe("describeStep: Settings → Reminders", () => {
  const r = { id: "r1", text: "Order the wine", active: true, times: ["11:00"] };
  function say(b, a) { return describeAny("reminders", b, a, changedPaths(b, a)); }
  it("added, deleted, paused, resumed and changed, named by the reminder's text", () => {
    expect(say([], [r])).toBe("Reminder “Order the wine” added");
    expect(say([r], [])).toBe("Reminder “Order the wine” deleted");
    expect(say([r], [{ ...r, active: false }])).toBe("Reminder “Order the wine” paused");
    expect(say([{ ...r, active: false }], [r])).toBe("Reminder “Order the wine” resumed");
    expect(say([r], [{ ...r, times: ["12:00"] }])).toBe("Reminder “Order the wine” changed");
    expect(say([], [{ ...r, text: "Call the fish supplier about Friday's order" }])).toBe("Reminder “Call the fish supplier about…” added");
  });
});

describe("describeStep: Settings → WhatsApp", () => {
  const w = { v: 1, autoArchiveOnComplete: true, autoArchiveSince: 5, autoReply: true };
  function say(b, a) { return describeAny("settings/whatsapp", b, a, changedPaths(b, a)); }
  it("names each switch by its section's title", () => {
    expect(say(w, { ...w, autoArchiveOnComplete: false })).toBe("Auto-archive switched off");
    expect(say({ ...w, autoReply: false }, w)).toBe("Auto-reply switched on");
  });
});

describe("describeStep: Settings → App", () => {
  function say(node, b, a) { return describeAny(node, b, a, changedPaths(b, a)); }
  it("names the switch or the row, on screen", () => {
    expect(say("app:theme", "light", "dark")).toBe("Dark mode switched on");
    expect(say("app:theme", "dark", "auto")).toBe("Automatic dark mode switched on");
    expect(say("app:theme", "auto", "light")).toBe("Automatic dark mode switched off");
    expect(say("app:appWidth", { width: 1200, fit: false }, { width: 1250, fit: false })).toBe("App width changed");
    expect(say("app:appWidth", { width: null, fit: true }, { width: 1300, fit: false })).toBe("Fit to screen switched off");
    expect(say("app:reduceMotion", false, true)).toBe("Reduce animations switched on");
    expect(say("app:cellBook", true, false)).toBe("Tap an empty cell to book switched off");
    const tl = { defaultZoom: 2, followZoom: 3, followLead: 30, maxZoom: 6 };
    expect(say("app:timeline", tl, { ...tl, followLead: 45 })).toBe("Time shown behind the now-line changed");
    expect(say("app:timeline", tl, { ...tl, maxZoom: 2.5, followZoom: 2.5, defaultZoom: 2 })).toBe("Timeline zoom changed");
    expect(say("app:dragHold", "normal", "long")).toBe("Drag hold changed");
  });
  it("two taps on one switch fold back to nothing", () => {
    const one = recordAny([], { node: "app:largeText", tab: "app", before: false, after: true }, describeAny);
    expect(one[0].label).toBe("Larger text switched on");
    expect(recordAny(one, { node: "app:largeText", tab: "app", before: true, after: false }, describeAny)).toEqual([]);
  });
});

describe("describeStep: Settings → Admin", () => {
  // The modules map as sanitizeModules stores it (lib/modules.js).
  const a = { v: 1, enforceRoles: false, modules: { vouchers: { enabled: true }, whatsapp: { enabled: true } }, activityRetentionDays: 365, waRetentionDays: 184 };
  function say(node, b, x, ctx) { return describeAny(node, b, x, changedPaths(b, x), ctx); }
  it("the admin node: the switch, a module by its label, the two retentions", () => {
    expect(say("settings/admin", a, { ...a, enforceRoles: true })).toBe("Enforce roles switched on");
    expect(say("settings/admin", a, { ...a, modules: { vouchers: { enabled: false }, whatsapp: { enabled: true } } })).toBe("Gift vouchers switched off");
    expect(say("settings/admin", { ...a, modules: { vouchers: { enabled: true }, whatsapp: { enabled: false } } }, a)).toBe("WhatsApp inbox switched on");
    expect(say("settings/admin", a, { ...a, activityRetentionDays: 90 })).toBe("Activity log retention changed");
    expect(say("settings/admin", a, { ...a, waRetentionDays: 30 })).toBe("WhatsApp retention changed");
  });
  it("a person: the level, or the capability ticked, named by the person", () => {
    const r = { role: "staff", extras: {}, denies: {} };
    expect(say("role:u1", r, { ...r, role: "manager" }, { name: "Ana" })).toBe("Level changed for Ana");
    expect(say("role:u1", r, { ...r, extras: { voucherRedeem: true } }, { name: "Ana", cap: "voucherRedeem", on: true })).toBe("“Redeem vouchers” given to Ana");
    expect(say("role:u1", r, { ...r, denies: { bookingEdit: true } }, { name: "Ana", cap: "bookingEdit", on: false })).toBe("“Edit bookings” taken from Ana");
  });
});

describe("stableKey compares a value as RTDB stores it", () => {
  it("an empty array, an empty object or a null is the same as absent, at any depth", () => {
    // Measured on DEV: a one-off reminder's `recurrence.days: []` came back
    // without `days`, and its Undo was refused as "Changed on another device".
    const wrote = [{ id: "r1", text: "x", recurrence: { type: "once", date: "2026-11-27", days: [] }, extras: {}, note: null }];
    const echo = [{ id: "r1", text: "x", recurrence: { type: "once", date: "2026-11-27" } }];
    expect(stableKey(wrote)).toBe(stableKey(echo));
    expect(stableKey([])).toBe(stableKey(undefined));
    expect(stableKey({ a: { b: [] } })).toBe(stableKey({}));
  });
  it("still tells apart what RTDB keeps: false, 0, an empty string, order", () => {
    expect(stableKey({ a: false })).not.toBe(stableKey({}));
    expect(stableKey({ a: 0 })).not.toBe(stableKey({}));
    expect(stableKey({ a: "" })).not.toBe(stableKey({}));
    expect(stableKey([1, 2])).not.toBe(stableKey([2, 1]));
  });
  it("an Undo of a new one-off reminder is not refused by the echo", () => {
    const after = [{ id: "r1", text: "x", recurrence: { type: "once", date: "2026-11-27", days: [] } }];
    const stack = recordAny([], { node: "reminders", tab: "reminders", before: [], after }, describeAny);
    const plan = undoAny(stack, function () { return [{ id: "r1", text: "x", recurrence: { type: "once", date: "2026-11-27" } }]; });
    expect(plan.refuse).toBeUndefined();
    expect(plan.restore).toEqual([]);
  });
});
