---
category: Motion
keywords: [transition, view, slide]
---
The entrance wrapper for a whole view. `dir` is the entrance CLASS: `"mgt-view-in-left"` / `"mgt-view-in-right"` when switching between Timeline, List and Plan (28px sideways), `"mgt-view-fade"` for a date change (no travel). Re-key it to replay. `fill` passes a definite height through inside a fixed-height flex column.

```jsx
const { SlideView } = window.MGTBookings;
<SlideView key={view} dir="mgt-view-in-right"><ListPane /></SlideView>
```
