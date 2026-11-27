// ── settings-undo ────────────────────────────────────────────────────────────
// v18.19.1 (Patryk): every change made in Settings → Layout can be taken back,
// one step at a time, back to when Settings opened. The pure core of that
// history; `useSettingsUndo` keeps the stack, the pill and the timer.
//
// A step is `{before, after, label, paths}`: the stored layout before the save
// and the layout the save wrote (both SANITIZED, so the two sides of every
// comparison went through the same function), the sentence the pill shows, and
// the leaf paths the save changed.
//
// Four rules, each Patryk's:
//  • **Every step, back to when Settings opened.** The stack is forgotten when
//    Settings closes (the hook's job).
//  • **Taps on one stepper in a row are one step.** A save that changes exactly
//    the one leaf the step on top changed is merged into it, keeping the older
//    `before`. Merged back to where it started, the step is dropped: + then −
//    is no change. The rule is by LEAF, never by time, so two taps a minute
//    apart on one stepper still merge and a tap on another stepper never does.
//  • **The pill names the next step** (`label` of the top).
//  • **Refuse and say why.** An Undo restores `before` only while the stored
//    layout is still the `after` this device wrote. Anything else means another
//    device (or a refused write's rollback) changed it since, and restoring
//    `before` would throw that change away. The refusal also empties the stack:
//    every older step chains from the one refused, so none could pass either.

// Key-order-insensitive JSON. RTDB hands an object's keys back SORTED, and
// `sanitizeLayout` copies a map such as `comboCaps` in the order it was given,
// so the echo of a write and the write itself can differ only in key order.
// Arrays keep their order: in a layout, order is meaning.
export function stableKey(v) {
  if (Array.isArray(v)) return "[" + v.map(stableKey).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ":" + stableKey(v[k]); }).join(",") + "}";
  }
  return v === undefined ? "null" : JSON.stringify(v);
}

// Every leaf path at which `a` and `b` differ, as dotted strings
// ("tables.3.capacity", "priorities.bands.1.prefer.0"). A path present on one
// side only is a difference at that path.
export function changedPaths(a, b, base) {
  const at = base || "";
  const out = [];
  const aObj = a && typeof a === "object";
  const bObj = b && typeof b === "object";
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) {
    if (stableKey(a) !== stableKey(b)) out.push(at);
    return out;
  }
  const keys = {};
  Object.keys(a).forEach(function (k) { keys[k] = true; });
  Object.keys(b).forEach(function (k) { keys[k] = true; });
  Object.keys(keys).sort().forEach(function (k) {
    changedPaths(a[k], b[k], at ? at + "." + k : k).forEach(function (p) { out.push(p); });
  });
  return out;
}

function sameItems(a, b) {
  if (a.length !== b.length) return false;
  const ka = a.map(stableKey).sort();
  const kb = b.map(stableKey).sort();
  return ka.every(function (k, i) { return k === kb[i]; });
}

// A list of things the optimiser reads: added, removed, reordered, or one item
// changed ("Size rule 2 changed").
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

// The sentence the pill shows for a step. `before` and `after` are sanitized
// layouts; `paths` is `changedPaths(before, after)`.
export function describeStep(before, after, paths) {
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

// The stack after a save of `after` over `before`. A save that changed nothing
// leaves the stack as it was (the same array, so a caller can compare).
export function recordStep(stack, before, after) {
  const paths = changedPaths(before, after);
  if (!paths.length) return stack;
  const last = stack.length ? stack[stack.length - 1] : null;
  // …and only when this save starts from what the last one wrote: a value
  // another device set between two taps would otherwise vanish into the merge,
  // and the Undo would restore over it without the refusal.
  if (last && paths.length === 1 && last.paths.length === 1 && last.paths[0] === paths[0]
      && stableKey(before) === stableKey(last.after)) {
    const merged = changedPaths(last.before, after);
    const rest = stack.slice(0, -1);
    if (!merged.length) return rest;
    return rest.concat([{ before: last.before, after: after, label: describeStep(last.before, after, merged), paths: merged }]);
  }
  return stack.concat([{ before: before, after: after, label: describeStep(before, after, paths), paths: paths }]);
}

// What an Undo press does, given the stack and the layout as stored now:
// `{restore, rest}` to write `restore` and keep `rest`, or `{refuse}` with the
// sentence the pill says instead. null when there is nothing to undo.
export const UNDO_CONFLICT = "Changed on another device, can't undo";
export function undoStep(stack, current) {
  if (!stack.length) return null;
  const top = stack[stack.length - 1];
  if (stableKey(current) !== stableKey(top.after)) return { refuse: UNDO_CONFLICT };
  return { restore: top.before, label: top.label, rest: stack.slice(0, -1) };
}
