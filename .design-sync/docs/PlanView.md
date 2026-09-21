---
category: Views
keywords: [floor plan, map, room, tables, occupancy, plan]
---
A top-down map of the restaurant: walls, doors and every table with its chairs, drawn from `layout.floorPlan` (centimetres, rendered through an SVG viewBox). Each table is filled by whoever occupies it at the selected time: seated green, confirmed amber, pending yellow, blocked red stripes, free neutral. A status mark is drawn below the table id, and a "~20m" pill shows on a seated table that frees up soon. A time strip above the room picks the moment and shows the day's busyness as a heat band. It starts at now on today and at opening time on any other day. Tap a table for its bookings, right-click or hold it for quick status, scroll or pinch to zoom.

- `layout` is `{ ...DEFAULT_LAYOUT, floorPlan }` — `tables` gives the ids, zones and capacities; `floorPlan` = `{ room: { w, h }, walls: [{ x1, y1, x2, y2 }], doors: [{ x, y, width, rot, flip }], tables: { [id]: { x, y, shape: "square" | "rect" | "round", w, h, rot, chairs: { top, right, bottom, left } } } }`.
- Which day is "today" comes from the device clock; `nowMins` only positions now within it.
- The plan draws no backdrop blur of its own beyond its glass card. Its popovers use the opaque popup tokens.

```jsx
const { PlanView, DEFAULT_LAYOUT } = window.MGTBookings;
<PlanView
  bookings={bookings} date={today} nowMins={20 * 60 + 10}
  layout={{ ...DEFAULT_LAYOUT, floorPlan }} freeing={{ b05: 20 }}
  onEdit={(booking) => openForm(booking)} onStatus={(id, status) => setStatus(id, status)}
  onWalkin={(tableId) => openWalkin(tableId)} />
```
