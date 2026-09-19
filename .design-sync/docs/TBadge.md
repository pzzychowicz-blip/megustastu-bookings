---
category: Badges
keywords: [table, badge]
---
A table id as a pill, coloured by zone: outdoor tables in teal (`TBL.out`), indoor tables (ids like `i1`–`i4`) in purple (`TBL.ind`). The same hue marks the table's label on the floor plan. The default layout's tables are `1A 1B 2 3 4 5A 5B 6 7` outdoors and `i1 i2 i3 i4` indoors (`ALL_TABLES`).

```jsx
const { TBadge, SP } = window.MGTBookings;
<div style={{ display: "flex", gap: SP.snug }}>{["5A", "5B"].map((t) => <TBadge key={t} id={t} />)}</div>
```
