---
category: Overlays
keywords: [modal title, heading, pill]
---
The pill heading at the top of a modal. It renders an `<h2>`, and `Overlay` names the dialog from it.

`background` is REQUIRED and follows the app's colour rule:
- a surface where you CREATE or ACT wears the colour of the button that opened it — `var(--app-new)` new booking, `var(--app-walkin)` walk-in, `var(--accent)` assign tables, `var(--btn-tables)` preferred tables, `BLOCK_BG.pending` waitlist;
- a surface where you CONFIGURE or READ wears the neutral `var(--app-btn-grey-strong)` — Settings, Find a booking.

```jsx
const { Overlay, ModalTitle } = window.MGTBookings;
<Overlay onClose={close}>
  <ModalTitle background="var(--app-walkin)">Walk-in</ModalTitle>
  …
</Overlay>
```
