---
category: Views
keywords: [list, cards, queue, bookings, day view, service]
---
The day as a queue of booking cards, in the order staff work it: seated parties first, then arrivals by time. Each card shows the name with its status badge, party size, table badges, phone, time window and notes, with one tap-target row: Assign, the next statuses, Delete. The card's border carries its state: a status colour, amber for a late party, red for an overstay about to hit the next booking. Completed and cancelled bookings fold into a "Completed & cancelled" `Collapsible` below the queue.

Same contract as the other views. Pass every booking; the view filters to `date` and reads past visits for the regular and repeat-no-show flags. The parent owns selection and the fold's open state, and every action goes out through a handler.

- `warnings[id]` = `{ next, nextTime, gap, overdue }` puts the overstay alert at the top of a seated card.
- `late[id]` = `"warn"` or `"noshow"`. At `"noshow"` the card offers a one-tap No show.
- `selectedId` gives a card the accent rim, and a tap on a card reports `onSelect(id)`. Keyboard ↑/↓ belongs to the parent: it moves `selectedId` and bumps `focusReq` to scroll the card into view.
- An empty day renders the `EmptyDay` prompt when `isEmpty` and `onNew` are passed.

```jsx
const { ListView } = window.MGTBookings;
const [showFinished, setShowFinished] = React.useState(false);
<ListView
  bookings={bookings} date="2026-09-26" today="2026-09-26" nowMins={20 * 60 + 10}
  late={{ b08: "warn" }} showFinished={showFinished} onToggleFinished={() => setShowFinished((v) => !v)}
  onEdit={(booking) => openForm(booking)} onStatus={(id, status) => setStatus(id, status)}
  onManual={(id) => assignTables(id)} onDelete={(id) => confirmDelete(id)} />
```
