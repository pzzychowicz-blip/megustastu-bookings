// src/lib/plan-hit.js
//
// v18.14.0 (L2) — a finger-sized target for each Plan table on a phone.
//
// A plan fits the screen, so on a 375px phone a table is drawn 21.5px wide, under
// WCAG 2.5.8's 24 and well under the app's 44. Pinch is available, and nobody should
// need it to tap a table. The drawn table must not change, because its size is the
// room's scale, so each table gets an invisible box around it instead.
//
// A box cannot simply be 44px. The closest pair of tables are 36px apart, centre to
// centre, so two 44px boxes overlap and a tap in the overlap goes to whichever was
// painted last, which can be the table further from the finger. So boxes meet halfway
// across the gap between two drawn tables: a tap lands on the nearer table, a box
// never covers another table, and no box ever loses the table it stands for.
//
// Pure, so that can be tested rather than eyeballed. PlanView owns WHEN it applies.

// The target, in the svg's user units (the room's centimetres). 44px at the narrowest
// phone the app is used on, where the room's 900 units are drawn 323px wide. A wider
// phone gets a little more, and the gaps cap it anyway.
export const PHONE_HIT = 124;

// The box a table is drawn in, in room units. A rectangle turned by `rot` needs its
// bounding box: the glyph rotates about its centre.
function drawnBox(e) {
  const w = e.w, h = e.shape === "rect" ? e.h : e.w;
  const rad = ((e.rot || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const hx = (w * c + h * s) / 2, hy = (w * s + h * c) / 2;
  return { l: e.x - hx, r: e.x + hx, t: e.y - hy, b: e.y + hy };
}

// `tables`: [{ id, x, y, w, h, shape, rot }], x and y being the table's centre. Returns
// { [id]: { x, y, w, h } } with x and y the box's top-left, ready for a <rect>. Each
// box holds its drawn table, is at most `size` across unless the table is wider, and
// overlaps no other box. Tables drawn over each other are left to their paint order.
export function hitBoxes(tables, size) {
  const rows = tables.map((e) => {
    const d = drawnBox(e);
    const hw = Math.max((d.r - d.l) / 2, size / 2), hh = Math.max((d.b - d.t) / 2, size / 2);
    return { id: e.id, d, l: e.x - hw, r: e.x + hw, t: e.y - hh, b: e.y + hh };
  });
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], z = rows[j];
      if (a.l >= z.r || z.l >= a.r || a.t >= z.b || z.t >= a.b) continue;
      const gapX = Math.max(a.d.l, z.d.l) - Math.min(a.d.r, z.d.r);
      const gapY = Math.max(a.d.t, z.d.t) - Math.min(a.d.b, z.d.b);
      if (gapX <= 0 && gapY <= 0) continue;
      // Split the axis with the wider gap, which takes the least from either box.
      if (gapX >= gapY) {
        const [left, right] = a.d.l <= z.d.l ? [a, z] : [z, a];
        const mid = (left.d.r + right.d.l) / 2;
        left.r = Math.min(left.r, mid);
        right.l = Math.max(right.l, mid);
      } else {
        const [top, bottom] = a.d.t <= z.d.t ? [a, z] : [z, a];
        const mid = (top.d.b + bottom.d.t) / 2;
        top.b = Math.min(top.b, mid);
        bottom.t = Math.max(bottom.t, mid);
      }
    }
  }
  const out = {};
  for (const r of rows) out[r.id] = { x: r.l, y: r.t, w: r.r - r.l, h: r.b - r.t };
  return out;
}
