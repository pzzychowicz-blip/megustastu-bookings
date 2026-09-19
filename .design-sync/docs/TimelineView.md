---
category: Views
keywords: [timeline, gantt, schedule, day view, tables, service, now-line]
---
The day as a grid: one row per table (outdoor ids teal, indoor purple) against a time axis that runs from opening to one hour past closing. Each booking is a block coloured by status — pending yellow, confirmed amber, seated green, completed grey; cancelled bookings are not drawn — carrying the guest's name, a party-size ring and one marker per flag (deposit, preferred table, locked, repeat no-show). A seated party's block runs up to now, with the rest of its planned time drawn dashed. A table block (`blocks`) paints red stripes over its window. When `date === today` a now-line marks `nowMins`. The optimiser switch, Follow and the zoom buttons sit above the grid, the legend below it.

It is a controlled view. The parent owns zoom, follow-now and the remembered scroll position and passes them in with their setters; every tap goes back out through a handler, and the view never writes data itself.

- Pass ALL bookings, not only the day's. The view filters to `date` itself and counts past no-shows across every date.
- `today` and `nowMins` are props, so the view renders any clock you give it: they drive the now-line and the late and freeing markers.
- `late`, `freeing` and `warnings` are maps keyed by booking id that the app derives from the bookings (shapes below).
- Status colours come from `BLOCK_BG` / `BLOCK_INK`; never restyle a block.
- The view is `React.memo`'d: keep every object and function prop referentially stable.

```jsx
const { TimelineView } = window.MGTBookings;
const [zoom, setZoom] = React.useState(1);
const [followNow, setFollowNow] = React.useState(false);
const scrollPosRef = React.useRef(0);
<TimelineView
  bookings={bookings} date="2026-09-26" today="2026-09-26" nowMins={20 * 60 + 10}
  late={{ b08: "warn" }} freeing={{ b05: 20 }}
  zoom={zoom} setZoom={setZoom} followNow={followNow} setFollowNow={setFollowNow} scrollPosRef={scrollPosRef}
  onEdit={(booking) => openForm(booking)} onManual={(id) => assignTables(id)} onStatus={(id, status) => setStatus(id, status)} />
```

A booking is `{ id, name, phone, date: "YYYY-MM-DD", time: "HH:MM", size, duration (minutes), status, tables: ["5A"], notes, deposit, preferredTables, _locked, _manual, noShow, stayedMin, updatedAt }`.
