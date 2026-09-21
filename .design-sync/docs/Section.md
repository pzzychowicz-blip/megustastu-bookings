---
category: Layout
keywords: [card, panel, container]
---
The standard content card: `var(--bg-soft)` fill, a `var(--border-soft)` hairline, `R.card` corners, 14px padding, a 14px bottom margin and `var(--shadow-soft)`. Group related fields inside a modal or a Settings tab with it. `style` merges over the defaults. For a card whose body folds away, use `Collapsible`.

```jsx
const { Section, T, FW } = window.MGTBookings;
<Section>
  <div style={{ fontSize: T.lead, fontWeight: FW.semi, marginBottom: 8 }}>Deposit</div>
  …
</Section>
```
