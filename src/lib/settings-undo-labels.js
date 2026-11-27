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

// ── The one entry point ──────────────────────────────────────────────────────
// A node with no describer of its own says "Setting changed": a step the pill
// cannot name is still a step it can take back. `tests/settings-undo.test.js`
// fails any node Settings records that falls through to it.
export const FALLBACK_LABEL = "Setting changed";
const DESCRIBERS = {
  "settings/layout": describeLayoutStep,
};
export function describeStep(node, before, after, paths) {
  const fam = node.indexOf(":") > 0 ? node.slice(0, node.indexOf(":")) : node;
  const fn = DESCRIBERS[fam];
  return fn ? fn(before, after, paths, node) : FALLBACK_LABEL;
}
