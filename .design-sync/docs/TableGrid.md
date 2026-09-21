---
category: Booking
keywords: [tables, picker, assign, walk-in, select tables]
---
The table picker used by the walk-in form and manual table assignment: every table as a pill-shaped cell, grouped by physical cluster, each group with its combination note ("1A+1B = 6 · table 7 = 4 standalone"). The cell text gives its state. A free cell is outlined teal (outdoor) or purple (indoor) and shows its capacity. Selected cells fill with the accent. A busy cell is dimmed red with a not-allowed cursor. In swap mode, a table held by a party that has not sat down yet is labelled "swap" and stays selectable.

It is purely presentational: the parent owns `selected` and decides what counts as busy.

- `busy` and `seatedBusy` are `Set`s of table ids; `selected` is an array.
- `swapBusy` turns on swap mode (manual assignment of an existing booking).
- A tap on a busy cell still calls `toggle`. Ignore busy ids there, as the app's pickers do.
- Put it straight on a modal body; it draws no card of its own.

```jsx
const { TableGrid } = window.MGTBookings;
const busy = new Set(["5A", "7", "2", "3"]);
const [selected, setSelected] = React.useState(["5B"]);
<TableGrid selected={selected} busy={busy} seatedBusy={new Set(["5A", "7"])} swapBusy={false}
  toggle={(id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : busy.has(id) ? s : [...s, id])} />
```
