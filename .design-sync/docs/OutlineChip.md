---
category: Badges
keywords: [chip, tag, count]
---
A chip that stands ALONE as a count or a disclosure — "3 visits", "1 no-show", "Regular · 5 past visits". No fill: a 2px border derived from the ink, bold text. `tone`: `success`, `warn`, `danger` or `neutral` (default) — the pair comes from `CHIP_TONES`. `size`: `"micro"` (default) or `"small"`. `as="button"` for a clickable chip; any other prop (onClick, title, aria-*, className) is passed through.

Several facts sitting side by side in one dense row are NOT outline chips — use plain icon-led text there.

```jsx
const { OutlineChip, SP } = window.MGTBookings;
<div style={{ display: "flex", gap: SP.snug }}>
  <OutlineChip tone="success">Regular · 5 past visits</OutlineChip>
  <OutlineChip tone="warn">1 no-show</OutlineChip>
</div>
```
