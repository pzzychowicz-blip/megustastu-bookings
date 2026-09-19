---
category: Badges
keywords: [status, badge, pill]
---
A booking's STATUS: the status fill (`BLOCK_BG`), its ink (`BLOCK_INK`), the `StatusIcon` mark and the word. Statuses are `pending`, `confirmed`, `seated`, `completed`, `cancelled`. Status is never colour alone — this badge and the timeline block both carry the mark.

```jsx
const { SBadge } = window.MGTBookings;
<SBadge status="seated" />
```
