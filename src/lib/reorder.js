// src/lib/reorder.js — v18.19.1 (Patryk, 2026-11-27)
//
// The pure half of drag-to-reorder in Settings → Layout: where an item lands,
// and the tables' zone rule. The drag itself (pointer, keys, motion) is
// `hooks/useDragReorder.js`; LayoutSettings asks these and saves the answer.
//
// Imports nothing, so a test can run it without the app.

// `list` with the item at `from` moved to `to`, as a NEW array. The SAME array
// when nothing moves (from === to, or either index is out of range), so a caller
// can tell "no change" by identity and write nothing.
export function moveItem(list, from, to) {
  if (!Array.isArray(list)) return list;
  const n = list.length;
  if (!(Number.isInteger(from) && Number.isInteger(to))) return list;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return list;
  const next = list.slice();
  const it = next.splice(from, 1)[0];
  next.splice(to, 0, it);
  return next;
}

// Where a dragged item lands: how many of the OTHER items come before it.
// `others` are their boxes ({left, top, width, height}) in their order, measured
// once when the drag starts and in the same coordinates as `point`, which is the
// dragged item's CENTRE now (not the pointer, so where it was grabbed does not
// matter). The answer is the dragged item's new index: take it out, put it back
// at this index (`moveItem(list, from, slotAt(...))`).
//
// `axis` "y" is a column: an item comes before the point when its centre is
// above it. "wrap" is a wrapping row (chips): before when its whole line is
// above the point, or when the point is on its line and its centre is to the
// left. A point between two lines counts every box above it.
//
// Measured from the layout at the START, never re-measured as the preview moves
// the others: the answer depends only on where the dragged item is, so it
// cannot feed back into itself and flicker between two slots.
export function slotAt(others, point, axis) {
  if (!Array.isArray(others) || !point) return 0;
  let k = 0;
  for (let i = 0; i < others.length; i++) {
    const b = others[i];
    const cy = b.top + b.height / 2;
    let before;
    if (axis === "wrap") {
      const bottom = b.top + b.height;
      if (bottom <= point.y) before = true;
      else if (b.top > point.y) before = false;
      else before = b.left + b.width / 2 < point.x;
    } else {
      before = cy < point.y;
    }
    if (before) k++;
  }
  return k;
}

const isIndoor = function (t) { return !!t && t.zone === "indoor"; };

// The tables as the Timeline draws them: outdoor first, then indoor, each zone
// keeping its own order (`buildLayout` in constants.js does the same split).
// Settings lists them this way and a table drag saves this order, so what the
// list shows is the order that takes effect. The SAME array when it is already
// in that order.
export function zoneOrdered(tables) {
  if (!Array.isArray(tables)) return tables;
  const out = tables.filter(function (t) { return !isIndoor(t); });
  const ins = tables.filter(isIndoor);
  const next = out.concat(ins);
  for (let i = 0; i < next.length; i++) if (next[i] !== tables[i]) return next;
  return tables;
}

// The tables of one zone, in order.
export function zoneTables(tables, zone) {
  const indoor = zone === "indoor";
  return (Array.isArray(tables) ? tables : []).filter(function (t) { return isIndoor(t) === indoor; });
}

// Move table `id` to index `to` AMONG ITS OWN ZONE's tables, and return the whole
// list zone-ordered (outdoor, then indoor). A table never crosses into the other
// zone this way: its Indoor / Outdoor switch is how it changes zone. The SAME
// array when nothing moves (an unknown id, `to` out of the zone's range, or the
// table already there, on a list already zone-ordered).
export function moveWithinZone(tables, id, to) {
  if (!Array.isArray(tables)) return tables;
  const t = tables.find(function (x) { return x && x.id === id; });
  if (!t) return tables;
  const zone = isIndoor(t) ? "indoor" : "outdoor";
  const mine = zoneTables(tables, zone);
  const from = mine.indexOf(t);
  const moved = moveItem(mine, from, to);
  const other = zoneTables(tables, zone === "indoor" ? "outdoor" : "indoor");
  if (moved === mine) return zoneOrdered(tables);
  return zone === "indoor" ? other.concat(moved) : moved.concat(other);
}
