---
category: Booking
keywords: [booking form, reservation, new booking, edit booking, modal, form]
---
The new / edit booking form, inside its own `Overlay`. Fields, top to bottom:

- customer name and phone (with autocomplete from past bookings)
- date, time, seating preference, number of guests and duration
- a live kitchen line ("Starting at this time: N bookings · M guests")
- the table preview, with Assign and a Preferred-table picker
- status (when editing), notes, deposit and repeat weekly

The footer holds Save pending, Back and Save booking; an edit adds Delete. Past visits on the same phone surface as chips under the name ("Regular · 3 past visits", "No-show ×2"), and an overlapping booking on the same phone shows a warning.

It is fully controlled. The parent owns `form` and passes `setForm`, so every keystroke goes through the parent; saving, closing and the sub-dialogs are callbacks.

- Build `form` from `EMPTY_FORM`: `{ ...EMPTY_FORM, date, name, phone, time: "21:30", size: 4 }`. For an edit, pass `editId` plus a draft of the booking's fields.
- Show a refused save through `error` (the message) and `errorField` (`"name"`, `"time"` …). The field keeps its normal look; the message appears in an alert just above the footer buttons, so it stays in view while the body scrolls.
- `bookings` feeds autocomplete, past-visit chips and table availability; pass all of them.
- `today` / `nowMins` decide whether seating is still open on the draft's date.

```jsx
const { BookingFormModal, EMPTY_FORM } = window.MGTBookings;
const [form, setForm] = React.useState({ ...EMPTY_FORM, date: "2026-09-26", time: "21:30", size: 4 });
<BookingFormModal form={form} setForm={setForm} editId={null} error="" errorField={null}
  bookings={bookings} liveBookings={bookings} tableBlocks={[]} autoOptimizer isMobile={false}
  today="2026-09-26" nowMins={20 * 60 + 10}
  onSave={save} onSavePending={savePending} onClose={close} />
```
