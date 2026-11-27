// v18.20.0 (Patryk): every change made in Settings can be taken back by its
// Undo pill. Three guards keep it that way as Settings grows:
//
//  1. WIRING. Every handler App hands SettingsContent, and the three modals
//     raised over Settings, is a tracked saver (`settingsUndo.save.<name>`) or
//     is named in NOT_UNDOABLE with its reason. A new control that skips the
//     history fails here rather than silently having no Undo.
//  2. ROUND TRIP. A step's `after` is what the writer sanitized; the Undo is
//     allowed only while the stored node, read back, still equals it. So each
//     node's sanitizer, applied to its own output as RTDB would store it (keys
//     sorted, no empty array, object or null), must give the same value back,
//     or every Undo of that node is refused as "Changed on another device"
//     (measured on DEV for a one-off reminder before stableKey learned the
//     RTDB shape, the v18.20.0 fix).
//  3. SENTENCES. Every node family App records has a describer, and a change
//     to any one setting a keyed node holds is named, never the node's catch-all.
import { describe, it, expect } from "vitest";
import { appCode } from "./app-source.js";
import { stableKey } from "../src/lib/settings-undo";
import { DESCRIBERS, describeStep, FALLBACK_LABEL } from "../src/lib/settings-undo-labels";
import { changedPaths } from "../src/lib/settings-undo";
import { sanitizeShifts } from "../src/hooks/useDayShifts.js";
import { sanitizeOptimizer } from "../src/hooks/useOptimizerSettings.js";
import { sanitizeGeneral } from "../src/hooks/useGeneralSettings.js";
import { sanitizeBookingDefaults } from "../src/hooks/useBookingDefaults.js";
import { sanitizeWa } from "../src/hooks/useWaSettings.js";
import { sanitizeAdminSettings } from "../src/hooks/useRoles.js";
import { sanitizeVoucherDefaults } from "../src/hooks/useVoucherDefaults.js";
import { sanitizeLayout } from "../src/hooks/useLayout.js";
import { sanitizeTagList } from "../src/lib/tags.js";
import { sanitizeRecurring } from "../src/lib/recurring.js";
import { sanitizeWeek } from "../src/lib/operating-hours.js";
import { sanitizeExceptions } from "../src/lib/special-days.js";

// App's source with its comments stripped (tests/app-source.js): a comment
// that quotes a prop would otherwise read as the prop.
const app = appCode();

// ── 1. Wiring ────────────────────────────────────────────────────────────────
// What Settings does that is not a settings change, or that Patryk kept out of
// the history (planning, 2026-11-27).
const NOT_UNDOABLE = {
  onDirty: "reports an unsaved text box; writes nothing",
  onOpenSpecialDay: "opens the special-day editor, whose save and remove are tracked (below)",
  onBackup: "downloads a backup; not a settings change (Patryk)",
  onDeleteCustomer: "permanent by design, behind an armed confirm (Patryk)",
  onIssueVoucher: "issuing a voucher is kept out (Patryk); void and reinstate are tracked",
  onClearTagError: "clears a message",
  onRemoveUser: "kept out (Patryk)",
  onInvite: "kept out (Patryk)",
  onWithdrawInvite: "kept out (Patryk)",
  onApplyInvite: "kept out (Patryk)",
  onOpenCapabilities: "opens RolesModal, whose ticks are tracked (below)",
  onOpenActivity: "opens the activity log",
  onAddReminder: "opens the reminder editor, whose save is tracked (below)",
  onEditReminder: "opens the reminder editor, whose save is tracked (below)",
  onDeleteReminder: "raises the confirm, whose Delete calls the tracked doDeleteReminder (below)",
};

function propsOf(tag) {
  const i = app.indexOf("<" + tag);
  expect(i).toBeGreaterThan(0);
  const block = app.slice(i, app.indexOf("/>", i));
  const out = {};
  const re = /\s(on[A-Z]\w*)=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}
function saverNames() {
  const i = app.indexOf("savers: {");
  expect(i).toBeGreaterThan(0);
  const block = app.slice(i, app.indexOf("\n    },", i));
  const names = {};
  const re = /(?:^|[\s{,])([a-zA-Z]\w*):\[/g;
  let m;
  while ((m = re.exec(block))) names[m[1]] = true;
  return names;
}

describe("1. every save Settings makes goes through its Undo history", () => {
  const props = propsOf("SettingsContent");
  const savers = saverNames();
  it("reads a sensible number of handlers (the parse found them)", () => {
    expect(Object.keys(props).length).toBeGreaterThan(40);
    expect(Object.keys(savers).length).toBeGreaterThan(40);
  });
  it("each handler is a tracked saver, or excluded with its reason", () => {
    const bare = Object.keys(props).filter(function (k) {
      return !/^settingsUndo\.save\.\w+$/.test(props[k]) && !NOT_UNDOABLE[k];
    });
    expect(bare).toEqual([]);
  });
  it("an exclusion names a handler that still exists and is not tracked", () => {
    Object.keys(NOT_UNDOABLE).forEach(function (k) {
      expect(props[k], k).toBeDefined();
      expect(props[k], k).not.toMatch(/settingsUndo\.save/);
    });
  });
  it("every tracked saver App names is in the savers handed to useSettingsUndo", () => {
    const used = app.match(/settingsUndo\.save\.(\w+)/g).map(function (s) { return s.split(".")[2]; });
    expect(used.filter(function (n) { return !savers[n]; })).toEqual([]);
  });
  it("the modals raised over Settings record into the same history", () => {
    expect(propsOf("RolesModal").onToggleCap).toBe("settingsUndo.save.capability");
    expect(propsOf("ReminderEditor").onSave).toBe("settingsUndo.save.reminderSave");
    expect(app).toContain("onSave={function(id,d){return settingsUndo.save.specialDay(id,d)||false;}}");
    expect(app).toMatch(/onRemove=\{function\(id\)\{return settingsUndo\.save\.removeSpecialDay\(id\)\|\|false;\}\}/);
    expect(app).toContain("const doDeleteReminder=settingsUndo.save.reminderDelete;");
  });
});

// ── 2. Round trip ────────────────────────────────────────────────────────────
// What RTDB hands back for a written value: keys sorted, and no empty array,
// empty object or null anywhere (an emptied container is simply absent).
function asRtdb(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const a = v.map(asRtdb).filter(function (x) { return x !== undefined; }); return a.length ? a : undefined; }
  if (typeof v === "object") {
    const o = {};
    Object.keys(v).sort().forEach(function (k) { const x = asRtdb(v[k]); if (x !== undefined) o[k] = x; });
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
// Each node: its sanitizer, and values a Settings save can write (the default,
// and the shapes that empty a list, the case RTDB rewrites).
const NODES = {
  "settings/dayShifts": [sanitizeShifts, [{ split: 18, enabled: false }]],
  "settings/optimizer": [sanitizeOptimizer, [{ cutoff: 17, autoSwitch: false }]],
  "settings/general": [sanitizeGeneral, [{ phoneCountry: "ES", undoSecs: 20 }]],
  "settings/bookingDefaults": [sanitizeBookingDefaults, [{ tiers: [{ maxSize: 4, dur: 90 }] }, { tiers: [] }]],
  "settings/whatsapp": [sanitizeWa, [{ autoArchiveOnComplete: false, autoArchiveSince: 1700000000000, autoReply: false }]],
  "settings/admin": [sanitizeAdminSettings, [{ enforceRoles: true, activityRetentionDays: 90 }]],
  "settings/voucherDefaults": [sanitizeVoucherDefaults, [{ expiryMonths: 6 }]],
  "settings/tags": [sanitizeTagList, [{ guest: [{ id: "g-vip", label: "VIP" }], occasion: [] }]],
  "recurring": [sanitizeRecurring, [{ enabled: true, horizonWeeks: 6, rules: [] }]],
  // The stored node is `{days: …}` (with `exceptions` beside it), and the hook's
  // state holds the week itself, so the week is read back from under `days`.
  "settings/operatingHours (week)": [sanitizeWeek, [{ days: { 0: { open: 13, close: 22, closed: true } } }], function (w) { return { days: w }; }],
  "settings/operatingHours (exceptions)": [sanitizeExceptions, [{ "2026-12-24": { date: "2026-12-24", closed: true, note: "" } }]],
};

describe("2. what a save writes reads back as the same value", () => {
  Object.keys(NODES).forEach(function (node) {
    const fn = NODES[node][0];
    const stored = NODES[node][2] || function (v) { return v; };
    const samples = [undefined].concat(NODES[node][1]);
    it(node, () => {
      samples.forEach(function (raw) {
        const wrote = fn(raw);
        expect(stableKey(fn(asRtdb(stored(wrote)))), JSON.stringify(raw)).toBe(stableKey(wrote));
      });
    });
  });
  // The writer sanitizes what the editor hands it, which is never `undefined`
  // (an absent node reads as the raw default, `defaultLayout()`), so the sample
  // is the default as stored. Its emptied lists are a ROADMAP entry of their own.
  it("settings/layout", () => {
    const wrote = sanitizeLayout(asRtdb(sanitizeLayout(undefined)));
    expect(stableKey(sanitizeLayout(asRtdb(wrote)))).toBe(stableKey(wrote));
  });
});

// ── 3. Sentences ─────────────────────────────────────────────────────────────
describe("3. every recorded change is named", () => {
  it("every node family App records has a describer", () => {
    const i = app.indexOf("nodes: {");
    const block = app.slice(i, app.indexOf("savers: {", i));
    const fams = (block.match(/\n {6}"([^"]+)": \{/g) || []).map(function (s) { return s.match(/"([^"]+)"/)[1]; });
    expect(fams.length).toBeGreaterThan(15);
    expect(fams.filter(function (f) { return !DESCRIBERS[f]; })).toEqual([]);
  });
  // One setting changed on a keyed node is named; two at once may take the
  // node's catch-all. Each value is flipped the way its control would.
  function flip(v) {
    if (typeof v === "boolean") return !v;
    if (typeof v === "number") return v + 1;
    if (typeof v === "string") return v + "x";
    return v;
  }
  const KEYED = {
    // phoneCountry / phonePrefix: nothing in Settings writes them since v18.2.0
    // (kept for older versions). pinnedCountries has its own list sentence.
    "settings/general": [sanitizeGeneral(undefined), ["v", "phoneCountry", "phonePrefix", "pinnedCountries"]],
    "settings/bookingDefaults": [sanitizeBookingDefaults(undefined), ["v", "tiers"]],
    "settings/whatsapp": [sanitizeWa(undefined), ["v", "autoArchiveSince"]],
    "settings/admin": [sanitizeAdminSettings(undefined), ["v", "modules"]],
    "settings/optimizer": [sanitizeOptimizer(undefined), []],
    "settings/dayShifts": [sanitizeShifts(undefined), []],
  };
  Object.keys(KEYED).forEach(function (node) {
    const base = KEYED[node][0];
    const skip = KEYED[node][1];
    it(node + ": each setting has its own sentence", () => {
      const keys = Object.keys(base).filter(function (k) { return skip.indexOf(k) < 0; });
      expect(keys.length).toBeGreaterThan(0);
      const two = Object.assign({}, base);
      two[keys[0]] = flip(base[keys[0]]);
      if (keys[1]) two[keys[1]] = flip(base[keys[1]]);
      const whole = describeStep(node, base, two, changedPaths(base, two));
      keys.forEach(function (k) {
        const after = Object.assign({}, base);
        after[k] = flip(base[k]);
        const said = describeStep(node, base, after, changedPaths(base, after));
        expect(said, k).not.toBe(FALLBACK_LABEL);
        if (keys.length > 1) expect(said, k).not.toBe(whole);
      });
    });
  });
});
