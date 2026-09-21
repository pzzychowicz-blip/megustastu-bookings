---
category: Floor plan
keywords: [table, svg, floor plan]
---
One table as an SVG group: its shape (round / rect / square), its chairs, and the id label pill in the table's zone colour. It must sit inside an `<svg>`; coordinates are centimetres in the room's own `viewBox`. `entry` is the floor-plan record `{ x, y, rot, shape, w, h, chairs: { top, right, bottom, left } }` (`h` only for `rect`). `fill` / `stroke` carry the occupancy colour (an occupied table: `BLOCK_BG[status]` with a `rgba(255,255,255,0.5)` stroke; a free one: `var(--bg-card)` with a `var(--fp-outline)` stroke); `children` render in the table's un-rotated centre column — the floor plan puts the `StatusIcon` just under the id pill at `translate(-IC.control/2, 11)`, coloured `BLOCK_INK[status]`, which stays put at any table rotation. Passing `onClick` makes it a focusable, named button.

```jsx
const { TableGlyph, BLOCK_BG, StatusIcon, IC } = window.MGTBookings;
<svg viewBox="0 0 300 200" width={300}>
  <TableGlyph id="5A" entry={{ x: 150, y: 100, rot: 0, shape: "rect", w: 120, h: 70, chairs: { top: 2, bottom: 2 } }}
    fill={BLOCK_BG.seated} stroke="rgba(255,255,255,0.5)" onClick={open} ariaLabel="Table 5A, Pau Estévez, seated" />
</svg>
```
