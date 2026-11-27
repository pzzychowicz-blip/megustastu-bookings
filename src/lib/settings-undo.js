// ── settings-undo ────────────────────────────────────────────────────────────
// v18.19.1 (Patryk): every change made in Settings → Layout can be taken back,
// one step at a time, back to when Settings opened. v18.20.0 (Patryk): every
// tab, in ONE history for the whole dialog. The pure core of that history;
// `useSettingsUndo` keeps the stack, the pill and the key, and what each step
// is called is `lib/settings-undo-labels.js`.
//
// A step is `{node, tab, before, after, label, paths}`:
//  • `node` — WHAT the step changed, one node per step (Patryk, v18.20.0: no
//    Settings action writes two, and two writes to two nodes cannot be atomic,
//    so a two-node step could be half undone). A settings path
//    ("settings/general", "recurring", "reminders") or a family and a key
//    ("voucher:1234", "guestTags:<identity>", "role:<uid>", "pref:theme").
//  • `tab` — the Settings tab it was made on, so the pill can name it when
//    you are on another (`pillText`).
//  • `before` / `after` — the node's value before the save and the value the
//    save wrote, both as the node's own writer SANITIZED it, so the two sides
//    of every comparison went through the same function.
//  • `label` — what the pill says; `paths` — the leaf paths that changed.
//
// Four rules, each Patryk's:
//  • **Every step, back to when Settings opened.** The stack is forgotten when
//    Settings closes (the hook's job).
//  • **Taps on one control in a row are one step.** A save that changes exactly
//    the one leaf the step on top changed, of the SAME node, is merged into it,
//    keeping the older `before`. Merged back to where it started, the step is
//    dropped: + then − is no change. By LEAF, never by time, so two taps a
//    minute apart on one stepper still merge and a tap on another stepper never
//    does.
//  • **The pill names the next step** (`pillText` of the top).
//  • **Refuse and say why.** An Undo restores `before` only while the stored
//    node is still the `after` this device wrote. Anything else means another
//    device (or a refused write's rollback) changed it since, and restoring
//    `before` would throw that change away. The refusal drops every step of
//    THAT node, since each older one chains from the one refused and none could
//    pass either, and keeps the steps of every other node (v18.20.0, Patryk).

// Key-order-insensitive JSON, of a value AS RTDB STORES IT. RTDB hands an
// object's keys back SORTED, and a sanitizer copies a map such as `comboCaps` in
// the order it was given, so the echo of a write and the write itself can
// differ only in key order. Arrays keep their order: in a layout, order is
// meaning. And RTDB stores no empty array, no empty object and no null
// (v18.20.0, measured): a one-off reminder's `recurrence.days: []` came back
// without `days`, and its Undo was refused as "Changed on another device". So
// those count as absent, at any depth, which is the only equality the echo can
// answer; a node whose reader has no sanitizer (`reminders`) needs nothing more.
function asStored(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(asStored);
    return a.length ? a : undefined;
  }
  if (typeof v === "object") {
    const o = {};
    let any = false;
    Object.keys(v).forEach(function (k) { const x = asStored(v[k]); if (x !== undefined) { o[k] = x; any = true; } });
    return any ? o : undefined;
  }
  return v;
}
function keyOf(v) {
  if (Array.isArray(v)) return "[" + v.map(keyOf).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + keyOf(v[k]); }).join(",") + "}";
  }
  return v === undefined ? "null" : JSON.stringify(v);
}
export function stableKey(v) { return keyOf(asStored(v)); }

// Every leaf path at which `a` and `b` differ, as dotted strings
// ("tables.3.capacity", "priorities.bands.1.prefer.0"). A path present on one
// side only is a difference at that path. Two different scalars differ at "".
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

// The stack after a save. `step` is `{node, tab, before, after, ctx?}`;
// `describe` is `(node, before, after, paths, ctx) → label` (`describeStep` in
// lib/settings-undo-labels.js; passed in so this file names no node). `ctx` is
// what a label needs that the node does not hold (a guest's name, a tag's
// label), taken when the save was made; a merge keeps the first. A save
// that changed nothing leaves the stack as it was (the same array, so a caller
// can compare).
export function recordStep(stack, step, describe) {
  const node = step.node;
  const paths = changedPaths(step.before, step.after);
  if (!paths.length) return stack;
  const last = stack.length ? stack[stack.length - 1] : null;
  // …and only when this save starts from what the last one wrote: a value
  // another device set between two taps would otherwise vanish into the merge,
  // and the Undo would restore over it without the refusal.
  if (last && last.node === node && paths.length === 1 && last.paths.length === 1 && last.paths[0] === paths[0]
      && stableKey(step.before) === stableKey(last.after)) {
    const merged = changedPaths(last.before, step.after);
    const rest = stack.slice(0, -1);
    if (!merged.length) return rest;
    const ctx = last.ctx || step.ctx;
    return rest.concat([{ node: node, tab: last.tab, before: last.before, after: step.after, ctx: ctx, label: describe(node, last.before, step.after, merged, ctx), paths: merged }]);
  }
  return stack.concat([{ node: node, tab: step.tab, before: step.before, after: step.after, ctx: step.ctx, label: describe(node, step.before, step.after, paths, step.ctx), paths: paths }]);
}

// What an Undo press does, given the stack and `currentOf(node)`, the node as
// stored now: `{restore, node, label, rest}` to write `restore` to `node` and
// keep `rest`, or `{refuse, rest}` with the sentence the pill says instead and
// the stack without that node's steps. null when there is nothing to undo.
export const UNDO_CONFLICT = "Changed on another device, can't undo";
export function undoStep(stack, currentOf) {
  if (!stack.length) return null;
  const top = stack[stack.length - 1];
  if (stableKey(currentOf(top.node)) !== stableKey(top.after)) {
    return { refuse: UNDO_CONFLICT, rest: stack.filter(function (s) { return s.node !== top.node; }) };
  }
  return { restore: top.before, node: top.node, label: top.label, rest: stack.slice(0, -1) };
}

// What the pill says for `step` while Settings shows `tab`: the step's label,
// led by the name of the tab it was made on when that is another (Patryk,
// v18.20.0: "General · Monday's hours changed"). `tabLabel(id)` names a tab.
export function pillText(step, tab, tabLabel) {
  if (!step) return "";
  if (!step.tab || step.tab === tab) return step.label;
  const name = tabLabel ? tabLabel(step.tab) : "";
  return name ? name + " · " + step.label : step.label;
}
