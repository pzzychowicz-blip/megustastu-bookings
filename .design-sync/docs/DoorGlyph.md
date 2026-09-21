---
category: Floor plan
keywords: [door, svg, floor plan]
---
A door on the floor plan: a wall-gap bar with a dashed quarter-circle swing. Inside an `<svg>`, in centimetres. `door` is `{ x, y, width, rot, flip }` — `flip` mirrors the hinge side. `selected` draws it in the accent colour.

```jsx
const { DoorGlyph } = window.MGTBookings;
<svg viewBox="0 0 200 140" width={200}><DoorGlyph door={{ x: 100, y: 120, width: 80, rot: 0 }} /></svg>
```
