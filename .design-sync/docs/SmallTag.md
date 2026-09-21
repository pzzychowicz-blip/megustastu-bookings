---
category: Badges
keywords: [tag, label, chip]
---
A generic small inline tag (`T.small`, semibold, pill-shaped). It has NO colours of its own — pass `style={{ background, color }}`. `label` may be a node, so a tag can lead with an icon.

```jsx
const { SmallTag, StarIcon, IC, SP } = window.MGTBookings;
<SmallTag label={<><StarIcon size={IC.inline} /> 5A · 5B</>} style={{ background: "var(--bg-veil)", color: "var(--text-secondary)" }} />
```
