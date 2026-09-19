---
category: Badges
keywords: [party size, guests, count]
---
The party size as a circled number (18px). Its default rim is a translucent white made for the saturated booking fills — on a light card pass `rim="var(--chip-neutral-border)"` instead. The digit inherits the text colour around it.

```jsx
const { SizeRing, BLOCK_BG } = window.MGTBookings;
<span style={{ color: "var(--text-on-accent)", background: BLOCK_BG.confirmed, padding: 6, borderRadius: 6, display: "inline-flex" }}><SizeRing n={4} /></span>
<SizeRing n={2} rim="var(--chip-neutral-border)" />
```
