---
category: Badges
keywords: [table, badge]
---
A table id as a pill, coloured by zone: outdoor tables in teal (`TBL.out`), indoor tables in purple (`TBL.ind`). The same hue marks the table's label on the floor plan. The default layout's tables are `1`–`9` outdoors and `10`–`13` indoors (`ALL_TABLES`); the zone is the table's own setting, not its name.

```jsx
const { TBadge, SP } = window.MGTBookings;
<div style={{ display: "flex", gap: SP.snug }}>{["6", "7"].map((t) => <TBadge key={t} id={t} />)}</div>
```
