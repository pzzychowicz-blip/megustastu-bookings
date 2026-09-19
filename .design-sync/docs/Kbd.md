---
category: Badges
keywords: [keyboard, shortcut, keycap]
---
A keyboard keycap for shortcut hints ("N new booking"). Monospace, with the pressed-key shading. `k` is the key's label.

```jsx
const { Kbd, SP } = window.MGTBookings;
<span style={{ display: "inline-flex", gap: SP.tight }}><Kbd k="⌘" /><Kbd k="K" /></span>
```
