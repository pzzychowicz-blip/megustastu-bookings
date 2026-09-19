---
category: Views
keywords: [calendar, week, month, stats, overview, covers]
---
The at-a-glance calendar popover. It opens as an `Overlay` with a Week / Month / Stats segmented control:

- **Week**: the 7 days, Monday to Sunday, each a row with a cover bar and its cover and booking counts.
- **Month**: a Monday-start grid tinted by busyness.
- **Stats**: the month's totals, busiest hours and table usage.

Today is highlighted in the accent. Tapping a day calls `onPick(date)`. The footer steps the period and returns to "This week" / "This month". The keyboard works too: W / M / S switch view, the arrows move, T goes to today, Enter opens the focused day.

- It renders its own `Overlay`. Mount it on its own (inside `ModalPresence` to animate the close), never inside another modal's body.
- Pass every booking: counts come from all dates (cancelled ones excluded).
- The mode is internal state and opens on Week.

```jsx
const { WeekView, ModalPresence } = window.MGTBookings;
<ModalPresence show={open}>
  <WeekView bookings={bookings} viewDate="2026-09-26"
    onPick={(date) => { setViewDate(date); setOpen(false); }} onClose={() => setOpen(false)} />
</ModalPresence>
```
