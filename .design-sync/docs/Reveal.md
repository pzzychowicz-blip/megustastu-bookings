---
category: Motion
keywords: [animation, expand, collapse, height]
---
Eases content open and closed by HEIGHT (a grid `0fr ↔ 1fr` transition) and keeps it mounted until the collapse has finished — so a banner or an error message never snaps in or out. Every show/hide in the app goes through it.

- `speed="reveal"` (default) — a disclosure opening under your finger.
- `speed="move"` — something arriving on its own (a notification, a date change).
- `horizontal` eases WIDTH instead.
- `presentational` removes its two wrapper divs from the accessibility tree (use it between a `role="list"` and its items).

```jsx
const { Reveal, InlineAlert } = window.MGTBookings;
<Reveal show={!!error}><InlineAlert>{error}</InlineAlert></Reveal>
```
