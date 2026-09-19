---
category: Forms
keywords: [date, input, weekday]
---
A native date input with its WEEKDAY inside the same pill ("Fri 11/09/2026") — how staff read "which day is this". `style` is the pill's look and lands on the wrapper: pass `mkInp()` for a form field. `inputProps` goes on the `<input>` itself — its `id`, `aria-label`, `Fld`'s attrs, `readOnly`. A tap anywhere on the pill opens the picker. The weekday slot has a fixed width so stepping days never shifts the layout.

```jsx
const { Fld, DateField, mkInp } = window.MGTBookings;
<Fld label="Date">{(id, attrs) =>
  <DateField value={date} onChange={(e) => setDate(e.target.value)} style={mkInp()} inputProps={{ id, ...attrs }} />}</Fld>
```
