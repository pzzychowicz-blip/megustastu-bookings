---
category: Layout
keywords: [disclosure, accordion, expand]
---
A `Section` whose title row toggles its body open and closed (the body eases with `Reveal`, the chevron turns). While collapsed an optional `summary` shows on the right so the section stays scannable; `subtitle` shows under the title only while open. Uncontrolled by default (`defaultOpen`); pass `open` + `onToggle` to control it. Settings is a column of these.

```jsx
const { Collapsible } = window.MGTBookings;
<Collapsible title="Opening hours" subtitle="Per weekday. A closed day blocks new bookings." summary="Mon–Sun 13:00–22:00">
  …
</Collapsible>
```
