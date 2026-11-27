// ── settings-undo-labels ─────────────────────────────────────────────────────
// v18.20.0 (Patryk): what Settings' Undo pill calls each step. The history
// itself is `lib/settings-undo.js`, which takes `describeStep` as an argument
// so it names no node.
//
// Patryk's wording rule (v18.20.0): the control's VISIBLE name, then what
// happened — changed, added, removed, reordered, paused, resumed, voided. The
// Layout tab's sentences are v18.19.1's, moved here unchanged.
//
// `describeStep(node, before, after, paths)`: `node` is the step's node id
// (`lib/settings-undo.js` says what one is), `before` / `after` the node's two
// sanitized values and `paths` their `changedPaths`.
import { stableKey } from "./settings-undo";

function sameItems(a, b) {
  if (a.length !== b.length) return false;
  const ka = a.map(stableKey).sort();
  const kb = b.map(stableKey).sort();
  return ka.every(function (k, i) { return k === kb[i]; });
}

// A list of things: added, removed, reordered, or one item changed
// ("Size rule 2 changed").
function listLabel(one, many, a, b, paths, prefix) {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  if (y.length > x.length) return one + " added";
  if (y.length < x.length) return one + " removed";
  if (sameItems(x, y)) return many + " reordered";
  const idx = {};
  paths.forEach(function (p) { if (p.indexOf(prefix + ".") === 0) idx[p.slice(prefix.length + 1).split(".")[0]] = true; });
  const ids = Object.keys(idx);
  return ids.length === 1 ? one + " " + (Number(ids[0]) + 1) + " changed" : many + " changed";
}

// ── Settings → Layout (v18.19.1) ─────────────────────────────────────────────
// `before` and `after` are sanitized layouts.
export function describeLayoutStep(before, after, paths) {
  const top = {};
  paths.forEach(function (p) { top[p.split(".")[0]] = true; });
  const pri = {};
  paths.forEach(function (p) { if (p.indexOf("priorities.") === 0) pri[p.split(".")[1]] = true; });
  const tb = before.tables || [];
  const ta = after.tables || [];
  if (top.tables) {
    const ib = tb.map(function (t) { return t.id; });
    const ia = ta.map(function (t) { return t.id; });
    if (ia.length > ib.length) return "Table " + ia.filter(function (id) { return ib.indexOf(id) < 0; })[0] + " added";
    if (ia.length < ib.length) return "Table " + ib.filter(function (id) { return ia.indexOf(id) < 0; })[0] + " removed";
    const gone = ib.filter(function (id) { return ia.indexOf(id) < 0; });
    if (gone.length === 1) return "Table " + gone[0] + " renamed";
    if (sameItems(tb, ta)) return "Tables reordered";
    const tp = paths.filter(function (p) { return p.indexOf("tables.") === 0; });
    const rows = {};
    tp.forEach(function (p) { rows[p.split(".")[1]] = true; });
    const ri = Object.keys(rows);
    if (ri.length === 1 && ta[ri[0]]) {
      const t = ta[ri[0]];
      if (tp.every(function (p) { return /\.zone$/.test(p); })) return "Table " + t.id + " moved " + (t.zone === "indoor" ? "indoors" : "outdoors");
      if (tp.every(function (p) { return /\.capacity$/.test(p); })) return "Seat count of table " + t.id + " changed";
    }
    return "Tables changed";
  }
  if (top.kitchenLimit) return "Kitchen limit changed";
  if (top.joinGroups) return "Joined tables changed";
  if (top.comboCaps) return "Combo seats changed";
  if (top.megaCombos) return listLabel("Cross-group combo", "Cross-group combos", before.megaCombos, after.megaCombos, paths, "megaCombos");
  if (top.priorities) {
    const pb = before.priorities || {};
    const pa = after.priorities || {};
    if (pri.bands) return listLabel("Size rule", "Size rules", pb.bands, pa.bands, paths, "priorities.bands");
    if (pri.comboRules) return listLabel("Combo rule", "Combo rules", pb.comboRules, pa.comboRules, paths, "priorities.comboRules");
    if (pri.swapRules) return listLabel("Swap rule", "Swap rules", pb.swapRules, pa.swapRules, paths, "priorities.swapRules");
    if (pri.anchors) return listLabel("Anchor", "Anchors", pb.anchors, pa.anchors, paths, "priorities.anchors");
    if (pri.mixedRequire) return "Cross-zone tables changed";
    return "Table priorities changed";
  }
  if (top.pickRules) {
    const rb = (before.pickRules && before.pickRules.rules) || [];
    const ra = (after.pickRules && after.pickRules.rules) || [];
    return listLabel("Pick rule", "Pick rules", rb, ra, paths, "pickRules.rules");
  }
  if (top.floorPlan) return "Floor plan changed";
  return "Layout changed";
}

// ── Shared shapes ────────────────────────────────────────────────────────────
// The top-level keys a step changed ("tiers.1.max" → "tiers").
function topKeys(paths) {
  const top = {};
  paths.forEach(function (p) { top[p.split(".")[0]] = true; });
  return Object.keys(top);
}
// A switch says which way it went; any other control says "changed".
function switchLabel(name, on) { return name + " switched " + (on ? "on" : "off"); }
// A node of named controls: `names` maps a key to the control's visible name,
// `switches` lists the keys that are switches. One key changed is named; more
// than one is `whole` (a save sends one control's value, so more than one
// means another control moved with it, which only a clamp does).
function keyedLabel(names, switches, whole, before, after, paths) {
  const keys = topKeys(paths).filter(function (k) { return k !== "v"; });
  if (keys.length !== 1 || !names[keys[0]]) return whole;
  const k = keys[0];
  return switches.indexOf(k) >= 0 ? switchLabel(names[k], after[k] === true) : names[k] + " changed";
}

// ── Settings → General ───────────────────────────────────────────────────────
// Weekday keys are UTC `getUTCDay()` order, as `settings/operatingHours` stores
// them (lib/day.js).
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// `before` / `after` are `{week, exceptions}`, useOperatingHours' state.
export function describeHoursStep(before, after, paths) {
  const days = {};
  paths.forEach(function (p) { const a = p.split("."); if (a[0] === "week") days[a[1]] = true; });
  const changed = Object.keys(days);
  if (changed.length) {
    if (changed.length === 1) return DAY_NAMES[Number(changed[0])] + "'s hours changed";
    const w = after.week || {};
    const first = stableKey(w[0]);
    const same = [1, 2, 3, 4, 5, 6].every(function (i) { return stableKey(w[i]) === first; });
    return same ? "Hours copied to all days" : "Opening hours changed";
  }
  const nb = Object.keys(before.exceptions || {}).length;
  const na = Object.keys(after.exceptions || {}).length;
  if (na > nb) return "Special day added";
  if (na < nb) return "Special day removed";
  return "Special day changed";
}
export function describeShiftsStep(before, after, paths) {
  return keyedLabel({ enabled: "Shifts", split: "Afternoon / Evening split" }, ["enabled"], "Shifts changed", before, after, paths);
}
export function describeOptimizerStep(before, after, paths) {
  return keyedLabel({ autoSwitch: "Auto-optimiser", cutoff: "Daily cutoff" }, ["autoSwitch"], "Auto-optimiser changed", before, after, paths);
}
const BOOKING_DEFAULT_NAMES = {
  turnaroundEnabled: "Separation between bookings", turnaroundMin: "Separation",
  lateEnabled: "Running late", lateWarnMin: "Highlight after", lateNoShowMin: "Offer no-show after",
  overlapWarnEnabled: "Overlap warnings", reshuffleSuggestEnabled: "Reshuffle suggestions",
  freeSoonEnabled: "Table turns", freeSoonWindow: "Predict up to",
};
const BOOKING_DEFAULT_SWITCHES = ["turnaroundEnabled", "lateEnabled", "overlapWarnEnabled", "reshuffleSuggestEnabled", "freeSoonEnabled"];
export function describeBookingDefaultsStep(before, after, paths) {
  const keys = topKeys(paths).filter(function (k) { return k !== "v"; });
  if (keys.length === 1 && keys[0] === "tiers") return listLabel("Booking duration", "Booking durations", before.tiers, after.tiers, paths, "tiers");
  if (keys.length === 1 && keys[0] === "restDur") return ((after.tiers || []).length ? "Larger parties'" : "All parties'") + " stay changed";
  if (keys.indexOf("tiers") >= 0) return "Booking durations changed";
  return keyedLabel(BOOKING_DEFAULT_NAMES, BOOKING_DEFAULT_SWITCHES, "Booking settings changed", before, after, paths);
}
const GENERAL_NAMES = {
  restaurantName: "Restaurant name", currency: "Currency symbol", timeZone: "Time zone",
  regularMin: "“Regular” from", lateCollapseMax: "Collapse banners above",
  waitMatchWin: "Waitlist match window", undoSecs: "Undo toast time",
  defaultBookingSize: "New booking size", defaultWalkinSize: "Walk-in size",
};
export function describeGeneralStep(before, after, paths) {
  const keys = topKeys(paths).filter(function (k) { return k !== "v"; });
  if (keys.length === 1 && keys[0] === "pinnedCountries") {
    const nb = (before.pinnedCountries || []).length;
    const na = (after.pinnedCountries || []).length;
    return na > nb ? "Pinned country added" : na < nb ? "Pinned country removed" : "Pinned countries changed";
  }
  return keyedLabel(GENERAL_NAMES, [], "Preferences changed", before, after, paths);
}
// `recurring` is `{v, enabled, horizonWeeks, rules}`; a rule names its guest.
export function describeRecurringStep(before, after, paths) {
  const keys = topKeys(paths).filter(function (k) { return k !== "v"; });
  if (keys.length === 1 && keys[0] === "enabled") return switchLabel("Standing bookings", after.enabled === true);
  if (keys.length === 1 && keys[0] === "horizonWeeks") return "Generate ahead changed";
  const rb = before.rules || [];
  const ra = after.rules || [];
  const ib = rb.map(function (r) { return r.id; });
  const ia = ra.map(function (r) { return r.id; });
  function who(r) { return r && r.name ? "Standing booking for " + r.name : "Standing booking"; }
  if (ra.length < rb.length) return who(rb.filter(function (r) { return ia.indexOf(r.id) < 0; })[0]) + " removed";
  if (ra.length > rb.length) return who(ra.filter(function (r) { return ib.indexOf(r.id) < 0; })[0]) + " added";
  const moved = ra.filter(function (r) {
    const o = rb.find(function (x) { return x.id === r.id; });
    return o && stableKey(o) !== stableKey(r);
  });
  if (moved.length === 1) {
    const r = moved[0];
    const o = rb.find(function (x) { return x.id === r.id; });
    if (o.active !== r.active) return who(r) + (r.active === false ? " paused" : " resumed");
    return who(r) + " changed";
  }
  return "Standing bookings changed";
}

// ── Settings → Customers ─────────────────────────────────────────────────────
// `settings/tags` is `{v, guest:[{id,label}], occasion:[{id,label}]}`; a tag is
// named by its label as the list shows it.
export function describeTagListStep(before, after) {
  function all(l) { return (l.guest || []).concat(l.occasion || []); }
  const b = all(before || {});
  const a = all(after || {});
  const byId = function (l, id) { return l.find(function (t) { return t.id === id; }); };
  const added = a.filter(function (t) { return !byId(b, t.id); });
  const gone = b.filter(function (t) { return !byId(a, t.id); });
  const renamed = a.filter(function (t) { const o = byId(b, t.id); return o && o.label !== t.label; });
  if (added.length === 1 && !gone.length) return "Tag “" + added[0].label + "” added";
  if (gone.length === 1 && !added.length) return "Tag “" + gone[0].label + "” removed";
  if (renamed.length === 1 && !added.length && !gone.length) return "Tag “" + b.find(function (t) { return t.id === renamed[0].id; }).label + "” renamed";
  return "Tags changed";
}
// A guest's tags (`guestTags:<identity>`): sorted tag ids. `ctx` carries the
// guest's name and the tag list's labels, as they were when the tap was made.
export function describeGuestTagsStep(before, after, paths, node, ctx) {
  const b = before || [];
  const a = after || [];
  const on = a.filter(function (id) { return b.indexOf(id) < 0; });
  const off = b.filter(function (id) { return a.indexOf(id) < 0; });
  const labels = ctx.labels || {};
  const who = ctx.name ? ctx.name : "";
  if (on.length === 1 && !off.length) return (labels[on[0]] || "Tag") + " added" + (who ? " for " + who : "");
  if (off.length === 1 && !on.length) return (labels[off[0]] || "Tag") + " removed" + (who ? " from " + who : "");
  return "Guest tags changed" + (who ? " for " + who : "");
}

// ── The one entry point ──────────────────────────────────────────────────────
// A node with no describer of its own says "Setting changed": a step the pill
// cannot name is still a step it can take back. `tests/settings-undo.test.js`
// fails any node Settings records that falls through to it.
export const FALLBACK_LABEL = "Setting changed";
const DESCRIBERS = {
  "settings/layout": describeLayoutStep,
  "settings/operatingHours": describeHoursStep,
  "settings/dayShifts": describeShiftsStep,
  "settings/optimizer": describeOptimizerStep,
  "settings/bookingDefaults": describeBookingDefaultsStep,
  "settings/general": describeGeneralStep,
  "recurring": describeRecurringStep,
  "settings/tags": describeTagListStep,
  "guestTags": describeGuestTagsStep,
};
export function describeStep(node, before, after, paths, ctx) {
  const fam = node.indexOf(":") > 0 ? node.slice(0, node.indexOf(":")) : node;
  const fn = DESCRIBERS[fam];
  return fn ? fn(before, after, paths, node, ctx || {}) : FALLBACK_LABEL;
}
